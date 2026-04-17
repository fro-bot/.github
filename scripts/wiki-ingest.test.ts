import {Buffer} from 'node:buffer'

import {describe, expect, it, vi} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiIngestModulePromise: Promise<{
  buildWikiIngestChanges: typeof import('./wiki-ingest.js').buildWikiIngestChanges
  commitWikiChanges: typeof import('./wiki-ingest.js').commitWikiChanges
  WikiIngestError: typeof import('./wiki-ingest.js').WikiIngestError
}> = import(`./wiki-ingest${'.js'}`)
const {buildWikiIngestChanges, commitWikiChanges, WikiIngestError} = await wikiIngestModulePromise

interface GitClient {
  rest: {
    git: {
      getRef: (params: {owner: string; repo: string; ref: string}) => Promise<{data: {object: {sha: string}}}>
      getCommit: (params: {owner: string; repo: string; commit_sha: string}) => Promise<{
        data: {sha: string; tree: {sha: string}}
      }>
      createBlob: (params: {owner: string; repo: string; content: string; encoding: 'utf-8'}) => Promise<{
        data: {sha: string}
      }>
      createTree: (params: {
        owner: string
        repo: string
        base_tree: string
        tree: {path: string; mode: '100644'; type: 'blob'; sha: string}[]
      }) => Promise<{data: {sha: string}}>
      createCommit: (params: {
        owner: string
        repo: string
        message: string
        tree: string
        parents: string[]
      }) => Promise<{data: {sha: string}}>
      updateRef: (params: {owner: string; repo: string; ref: string; sha: string; force: false}) => Promise<{
        data: {ref: string}
      }>
    }
  }
}

function createOctokitMock(overrides?: {
  getRef?: GitClient['rest']['git']['getRef']
  getCommit?: GitClient['rest']['git']['getCommit']
  createBlob?: GitClient['rest']['git']['createBlob']
  createTree?: GitClient['rest']['git']['createTree']
  createCommit?: GitClient['rest']['git']['createCommit']
  updateRef?: GitClient['rest']['git']['updateRef']
}): GitClient {
  return {
    rest: {
      git: {
        getRef: overrides?.getRef ?? (async () => ({data: {object: {sha: 'head-sha'}}})),
        getCommit:
          overrides?.getCommit ??
          (async () => ({
            data: {
              sha: 'head-sha',
              tree: {sha: 'tree-sha'},
            },
          })),
        createBlob:
          overrides?.createBlob ??
          (async ({content}: {content: string}) => ({data: {sha: `blob-${Buffer.byteLength(content, 'utf8')}`}})),
        createTree: overrides?.createTree ?? (async () => ({data: {sha: 'next-tree-sha'}})),
        createCommit: overrides?.createCommit ?? (async () => ({data: {sha: 'next-commit-sha'}})),
        updateRef: overrides?.updateRef ?? (async () => ({data: {ref: 'refs/heads/data'}})),
      },
    },
  }
}

describe('buildWikiIngestChanges', () => {
  it('updates repo and topic pages plus index and log in one ingest', () => {
    // #given existing empty wiki scaffolding and new repo/topic pages
    const result = buildWikiIngestChanges({
      existingFiles: {
        'knowledge/index.md': [
          '# Wiki Index',
          '',
          'Master catalog of all wiki pages, organized by type.',
          '',
          '## Repos',
          '',
          '_No repo pages yet. Pages will appear here as repositories are surveyed._',
          '',
          '## Topics',
          '',
          '_No topic pages yet. Pages will appear here as cross-cutting themes emerge._',
          '',
          '## Entities',
          '',
          '_No entity pages yet. Pages will appear here as tools and services are documented._',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
          '',
          '---',
          '',
          '_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._',
          '',
        ].join('\n'),
        'knowledge/log.md':
          '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n',
        'knowledge/wiki/repos/.gitkeep': '',
        'knowledge/wiki/topics/.gitkeep': '',
      },
      operation: 'survey',
      target: 'repo:fro-bot/agent',
      summary: 'Surveyed fro-bot/agent and captured repo plus testing knowledge.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [{url: 'https://github.com/fro-bot/agent', sha: 'abc123', accessed: '2026-04-16'}],
      pages: [
        {
          path: 'knowledge/wiki/repos/fro-bot--agent.md',
          content: [
            '---',
            'type: repo',
            'title: Fro Bot Agent',
            'created: 2026-04-16',
            'updated: 2026-04-16',
            'tags: [agent, automation]',
            '---',
            '',
            'Fro Bot Agent uses [[vitest]] for testing.',
            '',
          ].join('\n'),
        },
        {
          path: 'knowledge/wiki/topics/vitest.md',
          content: [
            '---',
            'type: topic',
            'title: Vitest',
            'created: 2026-04-16',
            'updated: 2026-04-16',
            'tags: [testing]',
            '---',
            '',
            'Vitest is used across [[fro-bot--agent]].',
            '',
          ].join('\n'),
        },
      ],
    })

    // #when the ingest changes are assembled
    const index = result.files['knowledge/index.md']
    const log = result.files['knowledge/log.md']

    // #then repo/topic pages, index, and log are updated coherently
    expect(result.files['knowledge/wiki/repos/fro-bot--agent.md']).toContain('type: repo')
    expect(result.files['knowledge/wiki/topics/vitest.md']).toContain('type: topic')
    expect(index).toContain('## Repos')
    expect(index).toContain('- [[fro-bot--agent]] — Fro Bot Agent')
    expect(index).toContain('## Topics')
    expect(index).toContain('- [[vitest]] — Vitest')
    expect(log).toContain('## [2026-04-16 12:34] ingest | repo:fro-bot/agent')
    expect(log).toContain('Sources: https://github.com/fro-bot/agent@abc123')
  })

  it('rejects pages with broken wikilinks', () => {
    // #given an ingest page that links to a missing wiki page
    const action = () =>
      buildWikiIngestChanges({
        existingFiles: {
          'knowledge/index.md': '# Wiki Index\n',
          'knowledge/log.md': '# Wiki Log\n',
        },
        operation: 'event',
        target: 'repo:fro-bot/.github',
        summary: 'Captured a bad page.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          {
            path: 'knowledge/wiki/repos/fro-bot--github.md',
            content: [
              '---',
              'type: repo',
              'title: Fro Bot .github',
              'created: 2026-04-16',
              'updated: 2026-04-16',
              '---',
              '',
              'Depends on [[missing-page]].',
              '',
            ].join('\n'),
          },
        ],
      })

    // #when ingest validation runs
    // #then it fails before any commit plan is produced
    expect(action).toThrow(WikiIngestError)
    expect(action).toThrow('missing-page')
  })
})

describe('commitWikiChanges', () => {
  it('creates an atomic multi-file commit and retries updateRef conflicts', async () => {
    const createBlob = vi.fn(async ({content}: {content: string}) => ({
      data: {sha: `blob-${Buffer.byteLength(content, 'utf8')}`},
    }))
    const createTree = vi.fn(async () => ({data: {sha: 'tree-after-write'}}))
    const createCommit = vi.fn(async () => ({data: {sha: 'commit-after-write'}}))
    const updateRef = vi
      .fn<GitClient['rest']['git']['updateRef']>()
      .mockRejectedValueOnce(Object.assign(new Error('Reference update failed'), {status: 409}))
      .mockResolvedValueOnce({data: {ref: 'refs/heads/data'}})
    const octokit = createOctokitMock({createBlob, createTree, createCommit, updateRef})

    // #given multiple wiki files that must land as one data-branch commit
    const result = await commitWikiChanges({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): ingest survey for fro-bot/agent',
      files: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/log.md': '# Wiki Log\n',
        'knowledge/wiki/repos/fro-bot--agent.md':
          '---\ntype: repo\ntitle: Fro Bot Agent\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n',
      },
      maxRetries: 2,
    })

    // #when the git data api write hits a ref conflict once
    // #then it retries and still lands a single coherent commit
    expect(result.committed).toBe(true)
    expect(result.commitSha).toBe('commit-after-write')
    expect(result.attempts).toBe(2)
    expect(createBlob).toHaveBeenCalledTimes(6)
    expect(createTree).toHaveBeenCalledTimes(2)
    expect(createCommit).toHaveBeenCalledTimes(2)
    expect(updateRef).toHaveBeenCalledTimes(2)
  })
})
