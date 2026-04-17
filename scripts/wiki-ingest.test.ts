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

function createEmptyWikiFiles(): Record<string, string> {
  return {
    'knowledge/index.md': '# Wiki Index\n',
    'knowledge/log.md': '# Wiki Log\n',
  }
}

function createWikiPage(params: {
  path: string
  type: 'repo' | 'topic' | 'entity' | 'comparison'
  title: string
  created?: string
  updated?: string
  body?: string
}): {path: string; content: string} {
  return {
    path: params.path,
    content: [
      '---',
      `type: ${params.type}`,
      `title: ${params.title}`,
      `created: ${params.created ?? '2026-04-16'}`,
      `updated: ${params.updated ?? '2026-04-16'}`,
      '---',
      '',
      params.body ?? 'Body.',
      '',
    ].join('\n'),
  }
}

describe('buildWikiIngestChanges', () => {
  it('rejects ingest payloads with no page updates', () => {
    // #given an ingest request with no wiki pages to write
    const action = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'repo:fro-bot/.github',
        summary: 'Tried to ingest nothing.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [],
      })

    // #when the ingest plan is assembled
    // #then it rejects the payload before writing anything
    expect(action).toThrow(WikiIngestError)
    expect(action).toThrow('at least one page')
  })

  it('accepts repo paths whose slugs contain dots', () => {
    // #given a repo wiki page for a dotfile-style repository name
    const result = buildWikiIngestChanges({
      existingFiles: createEmptyWikiFiles(),
      operation: 'event',
      target: 'repo:fro-bot/.github',
      summary: 'Captured control-plane repo knowledge.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/fro-bot--.github.md',
          type: 'repo',
          title: 'Fro Bot .github',
          body: 'Control-plane repository notes.',
        }),
      ],
    })

    // #when the ingest path validation runs
    // #then dot-containing repo slugs are accepted and emitted
    expect(result.files['knowledge/wiki/repos/fro-bot--.github.md']).toContain('type: repo')
  })

  it('builds index and log files when existing wiki files are missing', () => {
    // #given an ingest against an empty existing wiki snapshot
    const result = buildWikiIngestChanges({
      existingFiles: {},
      operation: 'event',
      target: 'repo:fro-bot/.github',
      summary: 'Bootstrapped wiki files from scratch.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/topics/wiki-ingest.md',
          type: 'topic',
          title: 'Wiki Ingest',
        }),
      ],
    })

    // #when the ingest planner synthesizes derived files
    // #then it tolerates missing on-disk inputs and creates the scaffolding
    expect(result.files['knowledge/index.md']).toContain('# Wiki Index')
    expect(result.files['knowledge/log.md']).toContain('# Wiki Log')
  })

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

  it('rejects pages without YAML frontmatter', () => {
    // #given a page body with no frontmatter block at all
    const action = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'repo:fro-bot/.github',
        summary: 'Tried to ingest malformed content.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          {
            path: 'knowledge/wiki/topics/wiki-ingest.md',
            content: 'No frontmatter here.\n',
          },
        ],
      })

    // #when frontmatter parsing runs
    // #then it rejects the page as malformed
    expect(action).toThrow(WikiIngestError)
    expect(action).toThrow('missing YAML frontmatter')
  })

  it('rejects pages whose frontmatter type does not match the directory', () => {
    // #given a topic file that claims to be a repo page
    const action = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'repo:fro-bot/.github',
        summary: 'Tried to ingest a mismatched page.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          createWikiPage({
            path: 'knowledge/wiki/topics/wiki-ingest.md',
            type: 'repo',
            title: 'Wiki Ingest',
          }),
        ],
      })

    // #when directory/type validation runs
    // #then it rejects the mismatched page type
    expect(action).toThrow(WikiIngestError)
    expect(action).toThrow('declares type repo but lives under topic')
  })

  it('rejects pages whose frontmatter dates are not YYYY-MM-DD', () => {
    // #given a page with non-ISO frontmatter dates
    const action = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'repo:fro-bot/.github',
        summary: 'Tried to ingest invalid dates.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          createWikiPage({
            path: 'knowledge/wiki/topics/wiki-ingest.md',
            type: 'topic',
            title: 'Wiki Ingest',
            created: '2026-4-16',
            updated: '2026/04/16',
          }),
        ],
      })

    // #when date validation runs
    // #then it rejects non-YYYY-MM-DD fields
    expect(action).toThrow(WikiIngestError)
    expect(action).toThrow('must use YYYY-MM-DD')
  })

  it('rejects repo filenames without the owner--repo separator', () => {
    // #given a repo page filename missing the repo slug separator
    const action = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'repo:fro-bot/.github',
        summary: 'Tried to ingest an invalid repo filename.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          createWikiPage({
            path: 'knowledge/wiki/repos/fro-bot-github.md',
            type: 'repo',
            title: 'Broken Repo Slug',
          }),
        ],
      })

    // #when filename validation runs
    // #then repo pages require the owner--repo slug format
    expect(action).toThrow(WikiIngestError)
    expect(action).toThrow('does not match wiki filename conventions for repo')
  })

  it('rejects comparison filenames without the -vs- separator', () => {
    // #given a comparison page filename missing the vs separator
    const action = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'comparison:alpha-beta',
        summary: 'Tried to ingest an invalid comparison filename.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          createWikiPage({
            path: 'knowledge/wiki/comparisons/alpha-beta.md',
            type: 'comparison',
            title: 'Alpha versus Beta',
          }),
        ],
      })

    // #when comparison filename validation runs
    // #then comparison pages require the -vs- slug format
    expect(action).toThrow(WikiIngestError)
    expect(action).toThrow('does not match wiki filename conventions for comparison')
  })

  it('rejects filenames with leading or trailing dashes', () => {
    // #given filenames that start or end with a dash
    const leadingDash = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'topic:leading-dash',
        summary: 'Tried to ingest a leading-dash topic filename.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          createWikiPage({
            path: 'knowledge/wiki/topics/-leading.md',
            type: 'topic',
            title: 'Leading Dash',
          }),
        ],
      })
    const trailingDash = () =>
      buildWikiIngestChanges({
        existingFiles: createEmptyWikiFiles(),
        operation: 'event',
        target: 'topic:trailing-dash',
        summary: 'Tried to ingest a trailing-dash topic filename.',
        timestamp: new Date('2026-04-16T12:34:00.000Z'),
        sources: [],
        pages: [
          createWikiPage({
            path: 'knowledge/wiki/topics/trailing-.md',
            type: 'topic',
            title: 'Trailing Dash',
          }),
        ],
      })

    // #when filename validation runs
    // #then leading and trailing dashes are rejected
    expect(leadingDash).toThrow(WikiIngestError)
    expect(trailingDash).toThrow(WikiIngestError)
  })
})

describe('commitWikiChanges', () => {
  it('rejects maxRetries values below one', async () => {
    // #given a commit request with an impossible retry budget
    const action = commitWikiChanges({
      octokit: createOctokitMock(),
      message: 'feat(knowledge): invalid retry budget',
      files: {'knowledge/index.md': '# Wiki Index\n'},
      maxRetries: 0,
    })

    // #when commit validation runs
    // #then it rejects the invalid retry count immediately
    await expect(action).rejects.toThrow(WikiIngestError)
    await expect(action).rejects.toThrow('maxRetries >= 1')
  })

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

  it('backs off exponentially before retrying a 409 ref conflict', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const updateRef = vi
      .fn<GitClient['rest']['git']['updateRef']>()
      .mockRejectedValueOnce(Object.assign(new Error('Reference update failed'), {status: 409}))
      .mockResolvedValueOnce({data: {ref: 'refs/heads/data'}})

    try {
      // #given a commit that collides once on ref update
      const startedAt = Date.now()
      const result = await commitWikiChanges({
        octokit: createOctokitMock({updateRef}),
        owner: 'fro-bot',
        repo: '.github',
        branch: 'data',
        message: 'feat(knowledge): retry with backoff',
        files: {'knowledge/index.md': '# Wiki Index\n'},
        maxRetries: 2,
      })
      const elapsedMs = Date.now() - startedAt

      // #when retry scheduling runs after the conflict
      // #then it waits with exponential backoff before the second attempt
      expect(result).toMatchObject({committed: true, attempts: 2})
      expect(elapsedMs).toBeGreaterThanOrEqual(1000)
      expect(updateRef).toHaveBeenCalledTimes(2)
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('raises CONFLICT_EXHAUSTED after every retry hits a 409 conflict', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const updateRef = vi
      .fn<GitClient['rest']['git']['updateRef']>()
      .mockRejectedValue(Object.assign(new Error('Reference update failed'), {status: 409}))

    try {
      // #given a commit whose ref update conflicts on every attempt
      const resultPromise = commitWikiChanges({
        octokit: createOctokitMock({updateRef}),
        owner: 'fro-bot',
        repo: '.github',
        branch: 'data',
        message: 'feat(knowledge): exhaust conflicts',
        files: {'knowledge/index.md': '# Wiki Index\n'},
        maxRetries: 3,
      })
      const assertion = expect(resultPromise).rejects.toMatchObject({code: 'CONFLICT_EXHAUSTED'})

      // #when all retries are consumed by 409 conflicts
      // #then it surfaces the dedicated conflict exhaustion error
      await vi.advanceTimersByTimeAsync(3000)
      await assertion
      expect(updateRef).toHaveBeenCalledTimes(3)
    } finally {
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not retry 422 updateRef failures', async () => {
    const updateRef = vi
      .fn<GitClient['rest']['git']['updateRef']>()
      .mockRejectedValue(Object.assign(new Error('Validation failed'), {status: 422}))

    // #given a non-conflict updateRef failure from GitHub
    const action = commitWikiChanges({
      octokit: createOctokitMock({updateRef}),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): fail fast on 422',
      files: {'knowledge/index.md': '# Wiki Index\n'},
      maxRetries: 3,
    })

    // #when the updateRef call fails with status 422
    // #then the original error bubbles without retries
    await expect(action).rejects.toMatchObject({status: 422})
    expect(updateRef).toHaveBeenCalledTimes(1)
  })
})
