import type {OctokitClient} from './wiki-ingest.ts'
import {Buffer} from 'node:buffer'

import {describe, expect, it, vi} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiIngestModulePromise: Promise<{
  buildWikiIngestChanges: typeof import('./wiki-ingest.js').buildWikiIngestChanges
  commitWikiChanges: typeof import('./wiki-ingest.js').commitWikiChanges
  countWikiPages: typeof import('./wiki-ingest.js').countWikiPages
  loadRepoNodeIdForTarget: typeof import('./wiki-ingest.js').loadRepoNodeIdForTarget
  parsePorcelainPaths: typeof import('./wiki-ingest.js').parsePorcelainPaths
  WikiIngestError: typeof import('./wiki-ingest.js').WikiIngestError
}> = import(`./wiki-ingest${'.js'}`)
const {
  buildWikiIngestChanges,
  commitWikiChanges,
  countWikiPages,
  loadRepoNodeIdForTarget,
  parsePorcelainPaths,
  WikiIngestError,
} = await wikiIngestModulePromise

interface MockOverrides {
  getBranch?: (params: {owner: string; repo: string; branch: string}) => Promise<unknown>
  getRef?: (params: {owner: string; repo: string; ref: string}) => Promise<unknown>
  getCommit?: (params: {owner: string; repo: string; commit_sha: string}) => Promise<unknown>
  getTree?: (params: {owner: string; repo: string; tree_sha: string; recursive: 'true'}) => Promise<unknown>
  createBlob?: (params: {owner: string; repo: string; content: string; encoding: 'utf-8'}) => Promise<unknown>
  createTree?: (params: {
    owner: string
    repo: string
    base_tree: string
    tree: {path: string; mode: '100644'; type: 'blob'; sha: string | null}[]
  }) => Promise<unknown>
  createCommit?: (params: {
    owner: string
    repo: string
    message: string
    tree: string
    parents: string[]
  }) => Promise<unknown>
  updateRef?: (params: {owner: string; repo: string; ref: string; sha: string; force: false}) => Promise<unknown>
}

function createOctokitMock(overrides?: MockOverrides): OctokitClient {
  return {
    rest: {
      repos: {
        getBranch:
          overrides?.getBranch ??
          (async ({branch}: {branch: string}) => ({data: {name: branch, commit: {sha: `${branch}-sha`}}})),
      },
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
        getTree: overrides?.getTree ?? (async () => ({data: {tree: []}})),
        createBlob:
          overrides?.createBlob ??
          (async ({content}: {content: string}) => ({data: {sha: `blob-${Buffer.byteLength(content, 'utf8')}`}})),
        createTree: overrides?.createTree ?? (async () => ({data: {sha: 'next-tree-sha'}})),
        createCommit: overrides?.createCommit ?? (async () => ({data: {sha: 'next-commit-sha'}})),
        updateRef: overrides?.updateRef ?? (async () => ({data: {ref: 'refs/heads/data'}})),
      },
    },
  } as unknown as OctokitClient
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
  node_id?: string
  aliases?: string[]
  sources?: {url: string; sha?: string; accessed: string}[]
  body?: string
}): {path: string; content: string} {
  const frontmatter = [
    '---',
    `type: ${params.type}`,
    `title: ${params.title}`,
    `created: ${params.created ?? '2026-04-16'}`,
    `updated: ${params.updated ?? '2026-04-16'}`,
    ...(params.node_id === undefined ? [] : [`node_id: ${params.node_id}`]),
    ...(params.sources === undefined
      ? []
      : [
          'sources:',
          ...params.sources.flatMap(source => [`  - url: ${source.url}`, `    accessed: ${source.accessed}`]),
        ]),
    ...(params.aliases === undefined ? [] : [`aliases: [${params.aliases.join(', ')}]`]),
    '---',
  ]
  return {
    path: params.path,
    content: [...frontmatter, '', params.body ?? 'Body.', ''].join('\n'),
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

  it('emits node_id in repo frontmatter when creating or updating a page', () => {
    const result = buildWikiIngestChanges({
      existingFiles: createEmptyWikiFiles(),
      operation: 'survey',
      target: 'repo:alice/project',
      summary: 'Surveyed the repository.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
        }),
      ],
    })

    expect(result.files['knowledge/wiki/repos/alice--project.md']).toContain('node_id: R_repo')
  })

  it('migrates a node-matched repo page to the current slug while preserving aliases, sources, and history', () => {
    const result = buildWikiIngestChanges({
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Surveyed the renamed repository.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--old-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--old-name.md',
          type: 'repo',
          title: 'alice/old-name',
          node_id: 'R_repo',
          aliases: ['historic-name'],
          sources: [{url: 'https://github.com/alice/old-name', accessed: '2026-04-15'}],
          body: 'Historical repository notes.',
        }).content,
      },
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
          body: 'Current repository notes.',
        }),
      ],
    })

    const migrated = result.files['knowledge/wiki/repos/alice--current-name.md']
    expect(migrated).toContain('title: alice/current-name')
    expect(migrated).toContain('node_id: R_repo')
    expect(migrated).toContain('historic-name')
    expect(migrated).toContain('alice--old-name')
    expect(migrated).toContain('https://github.com/alice/old-name')
    expect(migrated).toContain('Historical repository notes.')
    expect(migrated).toContain('Current repository notes.')
    expect(result.deletedPaths).toEqual(['knowledge/wiki/repos/alice--old-name.md'])
  })

  it('falls back to the current slug for legacy pages and backfills node_id', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--project.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
          sources: [{url: 'https://github.com/alice/project', accessed: '2026-04-15'}],
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/project',
      summary: 'Refreshed the legacy page.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
        }),
      ],
    })

    expect(result.deletedPaths).toEqual([])
    expect(result.files['knowledge/wiki/repos/alice--project.md']).toContain('node_id: R_repo')
    expect(result.files['knowledge/wiki/repos/alice--project.md']).not.toContain('https://github.com/alice/project')
  })

  it('does not migrate when node_id and current slug already match', () => {
    const page = createWikiPage({
      path: 'knowledge/wiki/repos/alice--project.md',
      type: 'repo',
      title: 'alice/project',
      node_id: 'R_repo',
      aliases: ['historic-name'],
    })
    const result = buildWikiIngestChanges({
      existingFiles: {...createEmptyWikiFiles(), [page.path]: page.content},
      operation: 'survey',
      target: 'repo:alice/project',
      summary: 'No identity migration required.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [page],
    })

    expect(result.deletedPaths).toEqual([])
    expect(result.files['knowledge/wiki/repos/alice--project.md']).toContain('historic-name')
    expect(result.files).not.toHaveProperty('knowledge/wiki/repos/alice--old-name.md')
  })

  it('resolves each repo page from its own slug instead of stamping the batch target identity', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/fro-bot--.github.md': createWikiPage({
          path: 'knowledge/wiki/repos/fro-bot--.github.md',
          type: 'repo',
          title: 'fro-bot/.github',
          node_id: 'R_control',
          body: 'Control-plane history.',
        }).content,
      },
      operation: 'survey',
      target: 'repo:fro-bot/.github',
      summary: 'Updated multiple repo pages.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_control',
      trackedRepoNodeIds: new Map([
        ['fro-bot--.github', 'R_control'],
        ['alice--containers', 'R_containers'],
      ]),
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--containers.md',
          type: 'repo',
          title: 'alice/containers',
          body: 'Container notes.',
        }),
      ],
    })

    expect(result.deletedPaths).toEqual([])
    expect(result.files['knowledge/wiki/repos/alice--containers.md']).toContain('title: alice/containers')
    expect(result.files['knowledge/wiki/repos/alice--containers.md']).toContain('node_id: R_containers')
    expect(result.files['knowledge/wiki/repos/alice--containers.md']).not.toContain('R_control')
  })

  it('rewrites inbound plain and piped wikilinks when migrating a repo page', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--old-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--old-name.md',
          type: 'repo',
          title: 'alice/old-name',
          node_id: 'R_repo',
        }).content,
        'knowledge/wiki/topics/ci.md': createWikiPage({
          path: 'knowledge/wiki/topics/ci.md',
          type: 'topic',
          title: 'CI',
          body: 'See [[alice--old-name]] and [[alice--old-name|the repository]].',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Migrated repository identity.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
        }),
      ],
    })

    expect(result.files['knowledge/wiki/topics/ci.md']).toContain('[[alice--current-name]]')
    expect(result.files['knowledge/wiki/topics/ci.md']).toContain('[[alice--current-name|the repository]]')
    expect(result.files['knowledge/wiki/topics/ci.md']).not.toContain('alice--old-name')
    expect(result.deletedPaths).toEqual(['knowledge/wiki/repos/alice--old-name.md'])
  })

  it('replaces same-slug legacy page content instead of concatenating historical body', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--project.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
          body: 'Existing revision.',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/project',
      summary: 'Replaced the legacy page content.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
          body: 'Incoming revision.',
        }),
      ],
    })

    const page = result.files['knowledge/wiki/repos/alice--project.md']
    expect(page).toContain('Incoming revision.')
    expect(page).not.toContain('Existing revision.')
    expect(page).toContain('node_id: R_repo')
  })

  it('keeps a collision page distinct while merging the node-matched page into the target slug', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--old-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--old-name.md',
          type: 'repo',
          title: 'alice/old-name',
          node_id: 'R_repo',
          body: 'Canonical historical body.',
        }).content,
        'knowledge/wiki/repos/alice--current-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
          node_id: 'R_other',
          body: 'Collision page body.',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Reconciled a repository page collision.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
          body: 'Fresh survey body.',
        }),
      ],
    })

    expect(result.files['knowledge/wiki/repos/alice--current-name.md']).toBe(
      [
        '---',
        'type: repo',
        'title: alice/current-name',
        'created: 2026-04-16',
        'updated: 2026-04-16',
        'aliases:',
        '  - alice--old-name',
        'node_id: R_repo',
        '---',
        '',
        'Fresh survey body.',
        '',
        'Canonical historical body.',
        '',
        'Collision page body.',
        '',
      ].join('\n'),
    )
    expect(result.deletedPaths).toEqual(['knowledge/wiki/repos/alice--old-name.md'])
  })

  it('uses tracked metadata before target and frontmatter identity values', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--project.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
          node_id: 'R_tracked',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/project',
      summary: 'Checked identity precedence.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      trackedRepoNodeIds: new Map([['alice--project', 'R_tracked']]),
      targetNodeId: 'R_target',
      fallbackNodeId: 'R_fallback',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
          node_id: 'R_frontmatter',
        }),
      ],
    })

    expect(result.files['knowledge/wiki/repos/alice--project.md']).toContain('node_id: R_tracked')
    expect(result.files['knowledge/wiki/repos/alice--project.md']).not.toContain('R_target')
    expect(result.files['knowledge/wiki/repos/alice--project.md']).not.toContain('R_fallback')
    expect(result.files['knowledge/wiki/repos/alice--project.md']).not.toContain('R_frontmatter')
  })

  it('removes database_id from every rendered page during validation', () => {
    const result = buildWikiIngestChanges({
      existingFiles: createEmptyWikiFiles(),
      operation: 'event',
      target: 'topic:wiki',
      summary: 'Sanitized rendered frontmatter.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      pages: [
        {
          path: 'knowledge/wiki/topics/wiki.md',
          content:
            '---\ntype: topic\ntitle: Wiki\ncreated: 2026-04-16\nupdated: 2026-04-16\ndatabase_id: 1174807412\n---\n\nTopic notes.\n',
        },
      ],
    })

    expect(result.files['knowledge/wiki/topics/wiki.md']).not.toContain('database_id')
  })

  it('falls back without identity when tracked metadata cannot resolve the target', async () => {
    const readFileImpl = async (_path: string, _encoding: BufferEncoding): Promise<string> => {
      throw Object.assign(new Error('missing'), {code: 'ENOENT'})
    }
    await expect(loadRepoNodeIdForTarget('repo:alice/project', readFileImpl)).resolves.toBeUndefined()
  })

  it('falls back without identity when tracked metadata is malformed', async () => {
    const readFileImpl = async (): Promise<string> => 'not: [valid'
    await expect(loadRepoNodeIdForTarget('repo:alice/project', readFileImpl)).resolves.toBeUndefined()
  })

  it('falls back without identity for private tracked repos', async () => {
    const readFileImpl = async (): Promise<string> =>
      'version: 1\nrepos:\n  - owner: alice\n    name: project\n    private: true\n    node_id: R_private\n'
    await expect(loadRepoNodeIdForTarget('repo:alice/project', readFileImpl)).resolves.toBeUndefined()
  })

  it('falls back without identity when the tracked entry has no node_id', async () => {
    const readFileImpl = async (): Promise<string> =>
      'version: 1\nrepos:\n  - owner: alice\n    name: project\n    private: false\n'
    await expect(loadRepoNodeIdForTarget('repo:alice/project', readFileImpl)).resolves.toBeUndefined()
  })

  it('falls back without identity when metadata still uses the pre-rename owner/name', async () => {
    const readFileImpl = async (): Promise<string> =>
      'version: 1\nrepos:\n  - owner: alice\n    name: old-name\n    private: false\n    node_id: R_repo\n'
    await expect(loadRepoNodeIdForTarget('repo:alice/current-name', readFileImpl)).resolves.toBeUndefined()
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
      .fn<(params: {owner: string; repo: string; ref: string; sha: string; force: false}) => Promise<unknown>>()
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

  it('includes the old repo page as a deletion when committing a rename migration', async () => {
    const createTree = vi.fn(
      async (_params: {tree: {path: string; mode: '100644'; type: 'blob'; sha: string | null}[]}) => ({
        data: {sha: 'tree-after-migration'},
      }),
    )
    const octokit = createOctokitMock({
      createTree,
      getTree: async () => ({
        data: {tree: [{path: 'knowledge/wiki/repos/alice--old-name.md'}]},
      }),
    })

    await commitWikiChanges({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): migrate renamed repo page',
      files: {'knowledge/wiki/repos/alice--current-name.md': 'current page'},
      deletedPaths: ['knowledge/wiki/repos/alice--old-name.md'],
    })

    const firstCall = createTree.mock.calls[0]
    expect(firstCall).toBeDefined()
    const tree = firstCall?.[0].tree
    expect(tree).toContainEqual({
      path: 'knowledge/wiki/repos/alice--current-name.md',
      mode: '100644',
      type: 'blob',
      sha: 'blob-12',
    })
    expect(tree).toContainEqual({
      path: 'knowledge/wiki/repos/alice--old-name.md',
      mode: '100644',
      type: 'blob',
      sha: null,
    })
  })

  it('omits stale deletion paths absent from the fresh base tree', async () => {
    const createTree = vi.fn(
      async (_params: {tree: {path: string; mode: '100644'; type: 'blob'; sha: string | null}[]}) => ({
        data: {sha: 'tree-after-migration'},
      }),
    )
    const octokit = createOctokitMock({createTree, getTree: async () => ({data: {tree: []}})})

    await commitWikiChanges({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): idempotent rename migration',
      files: {'knowledge/wiki/repos/alice--current-name.md': 'current page'},
      deletedPaths: ['knowledge/wiki/repos/alice--old-name.md'],
    })

    const tree = createTree.mock.calls[0]?.[0].tree
    expect(tree).not.toContainEqual(expect.objectContaining({path: 'knowledge/wiki/repos/alice--old-name.md'}))
  })

  it('bootstraps the data branch before reading the wiki head ref', async () => {
    const calls: string[] = []
    const bootstrapDataBranch = vi.fn(async () => {
      calls.push('bootstrap')
      return {created: false, ref: 'refs/heads/data', sha: 'data-sha'}
    })
    const octokit = createOctokitMock({
      getRef: async () => {
        calls.push('getRef')
        return {data: {object: {sha: 'head-sha'}}}
      },
    })

    await commitWikiChanges({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): ingest survey for fro-bot/agent',
      files: {'knowledge/index.md': '# Wiki Index\n'},
      bootstrapDataBranch,
    })

    expect(bootstrapDataBranch).toHaveBeenCalledWith({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      dataBranch: 'data',
    })
    expect(calls.slice(0, 2)).toEqual(['bootstrap', 'getRef'])
  })

  it('does not bootstrap when writing to a non-data branch', async () => {
    const bootstrapDataBranch = vi.fn(async () => {
      throw new Error('bootstrap should not run')
    })

    const result = await commitWikiChanges({
      octokit: createOctokitMock(),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'test-branch',
      message: 'feat(knowledge): write to test branch',
      files: {'knowledge/index.md': '# Wiki Index\n'},
      bootstrapDataBranch,
    })

    expect(result.committed).toBe(true)
    expect(bootstrapDataBranch).not.toHaveBeenCalled()
  })

  it('rejects main before creating wiki git objects', async () => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>()
    const createTree = vi.fn<NonNullable<MockOverrides['createTree']>>()
    const createCommit = vi.fn<NonNullable<MockOverrides['createCommit']>>()
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>()

    const error = await commitWikiChanges({
      octokit: createOctokitMock({createBlob, createTree, createCommit, updateRef}),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'main',
      message: 'feat(knowledge): reject protected target',
      files: {'knowledge/index.md': '# Wiki Index\n'},
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(WikiIngestError)
    expect((error as InstanceType<typeof WikiIngestError>).code).toBe('PROTECTED_BRANCH')
    expect(createBlob).not.toHaveBeenCalled()
    expect(createTree).not.toHaveBeenCalled()
    expect(createCommit).not.toHaveBeenCalled()
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('rejects a protected wiki target before creating git objects', async () => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>()
    const createTree = vi.fn<NonNullable<MockOverrides['createTree']>>()
    const createCommit = vi.fn<NonNullable<MockOverrides['createCommit']>>()
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>()

    const error = await commitWikiChanges({
      octokit: createOctokitMock({
        getBranch: async () => ({data: {name: 'protected-data', protected: true, protection: {enabled: false}}}),
        createBlob,
        createTree,
        createCommit,
        updateRef,
      }),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'protected-data',
      message: 'feat(knowledge): reject protected target',
      files: {'knowledge/index.md': '# Wiki Index\n'},
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(WikiIngestError)
    expect((error as InstanceType<typeof WikiIngestError>).code).toBe('PROTECTED_BRANCH')
    expect(createBlob).not.toHaveBeenCalled()
    expect(createTree).not.toHaveBeenCalled()
    expect(createCommit).not.toHaveBeenCalled()
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('rejects a wiki target with enabled branch protection before creating git objects', async () => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>()
    const createTree = vi.fn<NonNullable<MockOverrides['createTree']>>()
    const createCommit = vi.fn<NonNullable<MockOverrides['createCommit']>>()
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>()

    const error = await commitWikiChanges({
      octokit: createOctokitMock({
        getBranch: async () => ({data: {name: 'protected-data', protected: false, protection: {enabled: true}}}),
        createBlob,
        createTree,
        createCommit,
        updateRef,
      }),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'protected-data',
      message: 'feat(knowledge): reject protected target',
      files: {'knowledge/index.md': '# Wiki Index\n'},
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(WikiIngestError)
    expect((error as InstanceType<typeof WikiIngestError>).code).toBe('PROTECTED_BRANCH')
    expect(createBlob).not.toHaveBeenCalled()
    expect(createTree).not.toHaveBeenCalled()
    expect(createCommit).not.toHaveBeenCalled()
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('stops before wiki ref reads and writes when bootstrap fails', async () => {
    const bootstrapDataBranch = vi.fn(async () => {
      throw new Error('bootstrap failed')
    })
    const getRef = vi.fn<NonNullable<MockOverrides['getRef']>>()
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>()
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>()

    await expect(
      commitWikiChanges({
        octokit: createOctokitMock({getRef, createBlob, updateRef}),
        owner: 'fro-bot',
        repo: '.github',
        branch: 'data',
        message: 'feat(knowledge): stop on bootstrap failure',
        files: {'knowledge/index.md': '# Wiki Index\n'},
        bootstrapDataBranch,
      }),
    ).rejects.toThrow('bootstrap failed')

    expect(getRef).not.toHaveBeenCalled()
    expect(createBlob).not.toHaveBeenCalled()
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('rebootstraps and retries when data disappears before reading the wiki head ref', async () => {
    const calls: string[] = []
    const bootstrapDataBranch = vi.fn(async () => {
      calls.push('bootstrap')
      return {created: false, ref: 'refs/heads/data', sha: 'data-sha'}
    })
    const getRef = vi
      .fn<NonNullable<MockOverrides['getRef']>>()
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))
      .mockResolvedValue({data: {object: {sha: 'head-sha'}}})

    const result = await commitWikiChanges({
      octokit: createOctokitMock({getRef}),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): retry after missing data branch',
      files: {'knowledge/index.md': '# Wiki Index\n'},
      maxRetries: 2,
      bootstrapDataBranch,
    })

    expect(result.committed).toBe(true)
    expect(result.attempts).toBe(2)
    expect(bootstrapDataBranch).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(['bootstrap', 'bootstrap'])
  })

  it('backs off exponentially before retrying a 409 ref conflict', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const updateRef = vi
      .fn<(params: {owner: string; repo: string; ref: string; sha: string; force: false}) => Promise<unknown>>()
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
      .fn<(params: {owner: string; repo: string; ref: string; sha: string; force: false}) => Promise<unknown>>()
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
})

describe('parsePorcelainPaths', () => {
  it('extracts paths with X=space (unstaged worktree modification)', () => {
    // #given `git status --porcelain` output where the index position is unchanged (space)
    // and the worktree has a modification — this is what we produce when the survey agent
    // updates existing wiki files without staging them.
    // Regression: earlier logic called `.trim()` first, stripping the leading X-space,
    // then `.slice(3)` ate one character of the path. This test pins the fixed-offset parse.
    const stdout = ' M knowledge/wiki/repos/marcusrbrown--ha-config.md\n'

    // #when porcelain lines are parsed
    const paths = parsePorcelainPaths(stdout)

    // #then the full path survives, no leading character dropped
    expect(paths).toEqual(['knowledge/wiki/repos/marcusrbrown--ha-config.md'])
  })

  it('extracts paths with Y=space (staged modification) and added/untracked entries', () => {
    // #given a mixed porcelain listing covering all status variants the wiki commit path encounters
    const stdout = [
      'M  knowledge/index.md', // staged modification
      ' M knowledge/log.md', // unstaged modification
      'A  knowledge/wiki/repos/fro-bot--agent.md', // staged add
      '?? knowledge/wiki/topics/new-topic.md', // untracked
      '',
    ].join('\n')

    // #when porcelain lines are parsed
    const paths = parsePorcelainPaths(stdout)

    // #then every path emerges intact in input order
    expect(paths).toEqual([
      'knowledge/index.md',
      'knowledge/log.md',
      'knowledge/wiki/repos/fro-bot--agent.md',
      'knowledge/wiki/topics/new-topic.md',
    ])
  })

  it('strips trailing CR from windows-style line endings without touching the path', () => {
    // #given porcelain output terminated with \r\n (e.g., from a Windows git environment)
    const stdout = ' M knowledge/log.md\r\nA  knowledge/wiki/repos/marcusrbrown--vbs.md\r\n'

    // #when porcelain lines are parsed
    const paths = parsePorcelainPaths(stdout)

    // #then CRs are stripped but paths are preserved exactly
    expect(paths).toEqual(['knowledge/log.md', 'knowledge/wiki/repos/marcusrbrown--vbs.md'])
  })

  it('returns an empty array for empty or whitespace-only stdout', () => {
    // #given `git status --porcelain` output with no changes
    // #when porcelain lines are parsed
    // #then no paths are emitted (no spurious empty strings)
    expect(parsePorcelainPaths('')).toEqual([])
    expect(parsePorcelainPaths('\n\n\n')).toEqual([])
  })

  it('ignores malformed lines shorter than the status prefix', () => {
    // #given a pathological input with lines that can't possibly be porcelain entries
    const stdout = ['xy', 'ab', ' M valid/path.md', ''].join('\n')

    // #when porcelain lines are parsed
    const paths = parsePorcelainPaths(stdout)

    // #then only the well-formed entry is kept; short garbage is ignored
    expect(paths).toEqual(['valid/path.md'])
  })

  it('skips unstaged worktree deletions (X=space, Y=D)', () => {
    // #given a porcelain listing where an existing wiki page has been removed from the
    // worktree (e.g. by `git restore` pulling a different branch's knowledge/ snapshot
    // over the current checkout). Production incident: the survey-repo workflow's
    // `Sync wiki from data branch` step removes files that exist on main but not on
    // data, and those deletions must NOT be fed into wiki-ingest's readFile loop.
    const stdout = [
      ' M knowledge/wiki/repos/marcusrbrown--dotfiles.md', // agent-added content
      ' D knowledge/wiki/entities/mise.md', // drift-induced deletion
      '',
    ].join('\n')

    // #when porcelain lines are parsed
    const paths = parsePorcelainPaths(stdout)

    // #then the deletion is filtered out; only the present file survives
    expect(paths).toEqual(['knowledge/wiki/repos/marcusrbrown--dotfiles.md'])
  })

  it('skips staged deletions (X=D, Y=space)', () => {
    // #given a porcelain listing with a staged deletion alongside a normal modification
    const stdout = ['D  knowledge/wiki/entities/old-entity.md', ' M knowledge/log.md', ''].join('\n')

    // #when porcelain lines are parsed
    const paths = parsePorcelainPaths(stdout)

    // #then the staged deletion is filtered; the modification is preserved
    expect(paths).toEqual(['knowledge/log.md'])
  })

  it('skips deletions in all dual-position variants (DD, AD, MD, RD, CD)', () => {
    // #given porcelain lines covering every status combination where the file ends up
    // absent from the worktree — each would crash readFile if it reached
    // loadWorkingTreeWikiFiles.
    const stdout = [
      'DD knowledge/wiki/repos/both-deleted.md', // unmerged, both deleted
      'AD knowledge/wiki/repos/added-then-deleted.md', // added in index, deleted in worktree
      'MD knowledge/wiki/repos/modified-then-deleted.md', // modified in index, deleted in worktree
      'RD knowledge/wiki/repos/renamed-then-deleted.md', // renamed in index, deleted in worktree
      'CD knowledge/wiki/repos/copied-then-deleted.md', // copied in index, deleted in worktree
      ' M knowledge/wiki/repos/kept.md', // normal unstaged modification
      '',
    ].join('\n')

    // #when porcelain lines are parsed
    const paths = parsePorcelainPaths(stdout)

    // #then every variant with D in either position is dropped; the surviving path remains
    expect(paths).toEqual(['knowledge/wiki/repos/kept.md'])
  })
})

describe('commitWikiChanges (422 surfacing)', () => {
  it('does not retry 422 updateRef failures', async () => {
    const updateRef = vi
      .fn<(params: {owner: string; repo: string; ref: string; sha: string; force: false}) => Promise<unknown>>()
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

describe('countWikiPages', () => {
  it('counts pages in all four category directories', () => {
    // #given paths covering all four wiki entry categories
    const paths = [
      'knowledge/wiki/repos/fro-bot--agent.md',
      'knowledge/wiki/topics/vitest.md',
      'knowledge/wiki/entities/mise.md',
      'knowledge/wiki/comparisons/vitest-vs-jest.md',
    ]

    // #when the paths are counted
    // #then all four are included
    expect(countWikiPages(paths)).toBe(4)
  })

  it('excludes knowledge/index.md and knowledge/log.md', () => {
    // #given the catalog/log machinery files alongside a real entry
    const paths = ['knowledge/index.md', 'knowledge/log.md', 'knowledge/wiki/repos/fro-bot--agent.md']

    // #when the paths are counted
    // #then only the entry page is counted
    expect(countWikiPages(paths)).toBe(1)
  })

  it('excludes paths outside the four category directories', () => {
    // #given paths that live outside the four canonical category dirs
    const paths = ['knowledge/wiki/README.md', 'knowledge/schema.md', 'knowledge/wiki/repos/fro-bot--agent.md']

    // #when the paths are counted
    // #then only the entry under repos/ is counted
    expect(countWikiPages(paths)).toBe(1)
  })

  it('excludes nested paths and non-.md files', () => {
    // #given a nested path and a non-markdown file that should not count
    const paths = ['knowledge/wiki/repos/sub/x.md', 'knowledge/wiki/repos/x.txt', 'knowledge/wiki/topics/vitest.md']

    // #when the paths are counted
    // #then only the flat .md entry is counted
    expect(countWikiPages(paths)).toBe(1)
  })

  it('returns 0 for an empty input', () => {
    // #given no paths at all
    // #when the paths are counted
    // #then the result is zero
    expect(countWikiPages([])).toBe(0)
  })
})
