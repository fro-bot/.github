import type {OctokitClient} from './wiki-ingest.ts'
import {Buffer} from 'node:buffer'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiIngestModulePromise: Promise<{
  buildWikiIngestChanges: typeof import('./wiki-ingest.js').buildWikiIngestChanges
  commitWikiChanges: typeof import('./wiki-ingest.js').commitWikiChanges
  countWikiPages: typeof import('./wiki-ingest.js').countWikiPages
  deriveAgentLogEntries: typeof import('./wiki-ingest.js').deriveAgentLogEntries
  loadTrackedRepoNodeIds: typeof import('./wiki-ingest.js').loadTrackedRepoNodeIds
  parsePorcelainPaths: typeof import('./wiki-ingest.js').parsePorcelainPaths
  runWikiIngestCli: typeof import('./wiki-ingest.js').runWikiIngestCli
  validateWikilinks: typeof import('./wiki-ingest.js').validateWikilinks
  WikiIngestError: typeof import('./wiki-ingest.js').WikiIngestError
}> = import(`./wiki-ingest${'.js'}`)
const {
  buildWikiIngestChanges,
  commitWikiChanges,
  countWikiPages,
  deriveAgentLogEntries,
  loadTrackedRepoNodeIds,
  parsePorcelainPaths,
  runWikiIngestCli,
  validateWikilinks,
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

function createRepoMetadataEntry(params: {
  owner: string
  name: string
  node_id?: string
  database_id?: number
  private?: boolean
}): string {
  return [
    `  - owner: ${params.owner}`,
    `    name: ${params.name}`,
    '    added: 2026-04-16',
    '    onboarding_status: pending',
    '    last_survey_at: null',
    '    last_survey_status: null',
    '    has_fro_bot_workflow: false',
    '    has_renovate: false',
    `    private: ${params.private ?? false}`,
    ...(params.node_id === undefined ? [] : [`    node_id: ${params.node_id}`]),
    ...(params.database_id === undefined ? [] : [`    database_id: ${params.database_id}`]),
  ].join('\n')
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
    await expect(loadTrackedRepoNodeIds(readFileImpl)).resolves.toMatchObject({nodeIds: new Map()})
  })

  it('preserves an existing node_id and warns when tracked metadata is unavailable', async () => {
    const readFileImpl = async (_path: string, _encoding: BufferEncoding): Promise<string> => {
      throw Object.assign(new Error('metadata unavailable'), {code: 'ENOENT'})
    }
    const tracked = await loadTrackedRepoNodeIds(readFileImpl)
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--project.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
          node_id: 'R_existing',
          body: 'Existing identity.',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/project',
      summary: 'Metadata was unavailable.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      trackedRepoNodeIds: tracked.nodeIds,
      trackedMetadataAvailable: tracked.metadataAvailable,
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--project.md',
          type: 'repo',
          title: 'alice/project',
          body: 'Updated content.',
        }),
      ],
    })

    expect(tracked.warnings).toEqual([{code: 'repos-metadata-unavailable', reason: 'read-failed'}])
    expect(result.files['knowledge/wiki/repos/alice--project.md']).toContain('node_id: R_existing')
  })

  it('falls back without identity when tracked metadata is malformed', async () => {
    const readFileImpl = async (): Promise<string> => 'not: [valid'
    await expect(loadTrackedRepoNodeIds(readFileImpl)).resolves.toMatchObject({nodeIds: new Map()})
  })

  it('falls back without identity for private tracked repos', async () => {
    const readFileImpl = async (): Promise<string> =>
      `version: 1\nrepos:\n${createRepoMetadataEntry({owner: 'alice', name: 'project', private: true, node_id: 'R_private'})}\n`
    await expect(loadTrackedRepoNodeIds(readFileImpl)).resolves.toMatchObject({nodeIds: new Map()})
  })

  it('falls back without identity when the tracked entry has no node_id', async () => {
    const readFileImpl = async (): Promise<string> =>
      `version: 1\nrepos:\n${createRepoMetadataEntry({owner: 'alice', name: 'project'})}\n`
    await expect(loadTrackedRepoNodeIds(readFileImpl)).resolves.toMatchObject({nodeIds: new Map()})
  })

  it('falls back without identity when metadata still uses the pre-rename owner/name', async () => {
    const readFileImpl = async (): Promise<string> =>
      `version: 1\nrepos:\n${createRepoMetadataEntry({owner: 'alice', name: 'old-name', node_id: 'R_repo'})}\n`
    const result = await loadTrackedRepoNodeIds(readFileImpl)
    expect(result.nodeIds.get('alice--current-name')).toBeUndefined()
    expect(result.nodeIds.get('alice--old-name')).toBe('R_repo')
  })

  it('drops every slug sharing a tracked node_id and surfaces a structured warning', async () => {
    const readFileImpl = async (): Promise<string> =>
      `version: 1\nrepos:\n${createRepoMetadataEntry({
        owner: 'marcusrbrown',
        name: 'marcusrbrown.github.io',
        node_id: 'R_duplicate',
        database_id: 1174807412,
      })}\n${createRepoMetadataEntry({
        owner: 'marcusrbrown',
        name: 'mrbro.dev',
        node_id: 'R_duplicate',
        database_id: 1174807412,
      })}\n`

    const result = await loadTrackedRepoNodeIds(readFileImpl)

    expect(result.nodeIds).toEqual(new Map())
    expect(result.warnings).toEqual([
      {
        code: 'duplicate-repo-identity',
        node_ids: ['R_duplicate'],
        slugs: ['marcusrbrown--marcusrbrown-github-io', 'marcusrbrown--mrbro-dev'],
      },
    ])
  })

  it('drops a database_id collision even when node_id formats have diverged', async () => {
    const readFileImpl = async (): Promise<string> =>
      `version: 1\nrepos:\n${createRepoMetadataEntry({
        owner: 'alice',
        name: 'legacy-name',
        node_id: 'MDEwOlJlcG9zaXRvcnkx',
        database_id: 1174807412,
      })}\n${createRepoMetadataEntry({
        owner: 'alice',
        name: 'current-name',
        node_id: 'R_kgDOcurrent',
        database_id: 1174807412,
      })}\n`

    const result = await loadTrackedRepoNodeIds(readFileImpl)

    expect(result.nodeIds).toEqual(new Map())
    expect(result.warnings).toEqual([
      {
        code: 'duplicate-repo-identity',
        node_ids: ['MDEwOlJlcG9zaXRvcnkx', 'R_kgDOcurrent'],
        slugs: ['alice--current-name', 'alice--legacy-name'],
      },
    ])
    expect(JSON.stringify(result.warnings)).not.toContain('1174807412')
  })

  it('refuses migration when a tracked node_id is duplicated', async () => {
    const readFileImpl = async (): Promise<string> =>
      `version: 1\nrepos:\n${createRepoMetadataEntry({owner: 'alice', name: 'old-name', node_id: 'R_duplicate'})}\n${createRepoMetadataEntry({owner: 'alice', name: 'current-name', node_id: 'R_duplicate'})}\n`
    const tracked = await loadTrackedRepoNodeIds(readFileImpl)
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--old-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--old-name.md',
          type: 'repo',
          title: 'alice/old-name',
          node_id: 'R_duplicate',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Skipped ambiguous identity.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      trackedRepoNodeIds: tracked.nodeIds,
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
        }),
      ],
    })

    expect(result.deletedPaths).toEqual([])
    expect(result.files).not.toHaveProperty('knowledge/wiki/repos/alice--old-name.md')
  })

  it('does not delete a node-matched page when the only identity is untrusted', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--old-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--old-name.md',
          type: 'repo',
          title: 'alice/old-name',
          node_id: 'R_agent-authored',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Refused untrusted identity migration.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      fallbackNodeId: 'R_agent-authored',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
        }),
      ],
    })

    expect(result.deletedPaths).toEqual([])
    expect(result.files['knowledge/wiki/repos/alice--old-name.md']).toBeUndefined()
    expect(result.files['knowledge/wiki/repos/alice--current-name.md']).not.toContain('node_id:')
  })

  it('does not stack historical bodies when the same migration is ingested twice', () => {
    const first = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/wiki/repos/alice--old-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--old-name.md',
          type: 'repo',
          title: 'alice/old-name',
          node_id: 'R_repo',
          body: 'Historical body.',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Migrated once.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
          body: 'Current body.',
        }),
      ],
    })
    const postMigration = {...createEmptyWikiFiles(), ...first.files}
    const second = buildWikiIngestChanges({
      existingFiles: postMigration,
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Migrated twice.',
      timestamp: new Date('2026-04-16T12:34:00.000Z'),
      sources: [],
      targetNodeId: 'R_repo',
      pages: [
        createWikiPage({
          path: 'knowledge/wiki/repos/alice--current-name.md',
          type: 'repo',
          title: 'alice/current-name',
          body: 'Current body.',
        }),
      ],
    })

    expect(second.deletedPaths).toEqual([])
    expect(second.files['knowledge/wiki/repos/alice--current-name.md']).toContain('Current body.')
    expect(second.files['knowledge/wiki/repos/alice--current-name.md']).not.toContain(
      'Historical body.\n\nHistorical body.',
    )
  })

  it('rewrites inbound links in the committed log during migration', () => {
    const result = buildWikiIngestChanges({
      existingFiles: {
        ...createEmptyWikiFiles(),
        'knowledge/log.md': '# Wiki Log\n\nSee [[alice--old-name]].\n',
        'knowledge/wiki/repos/alice--old-name.md': createWikiPage({
          path: 'knowledge/wiki/repos/alice--old-name.md',
          type: 'repo',
          title: 'alice/old-name',
          node_id: 'R_repo',
        }).content,
      },
      operation: 'survey',
      target: 'repo:alice/current-name',
      summary: 'Migrated repository log links.',
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

    expect(result.files['knowledge/log.md']).toContain('[[alice--current-name]]')
    expect(result.files['knowledge/log.md']).not.toContain('alice--old-name')
  })

  it('fails closed when the fresh base tree is truncated', async () => {
    const createTree = vi.fn(
      async (_params: {tree: {path: string; mode: '100644'; type: 'blob'; sha: string | null}[]}) => ({
        data: {sha: 'tree-after-migration'},
      }),
    )
    const octokit = createOctokitMock({
      createTree,
      getTree: async () => ({
        data: {truncated: true, tree: [{path: 'knowledge/wiki/repos/alice--old-name.md'}]},
      }),
    })

    await commitWikiChanges({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): skip uncertain deletion',
      files: {'knowledge/wiki/repos/alice--current-name.md': 'current page'},
      deletedPaths: ['knowledge/wiki/repos/alice--old-name.md'],
    })

    expect(createTree.mock.calls[0]?.[0].tree).not.toContainEqual(
      expect.objectContaining({path: 'knowledge/wiki/repos/alice--old-name.md'}),
    )
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

  it('writes to protected data for the canonical repository when protected is true', async () => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>(async () => ({data: {sha: 'blob-sha'}}))
    const createTree = vi.fn<NonNullable<MockOverrides['createTree']>>(async () => ({data: {sha: 'tree-sha'}}))
    const createCommit = vi.fn<NonNullable<MockOverrides['createCommit']>>(async () => ({data: {sha: 'commit-sha'}}))
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>(async () => ({data: {ref: 'refs/heads/data'}}))

    const result = await commitWikiChanges({
      octokit: createOctokitMock({
        getBranch: async () => ({
          data: {name: 'data', protected: true, protection: {enabled: false}, commit: {sha: 'data-sha'}},
        }),
        createBlob,
        createTree,
        createCommit,
        updateRef,
      }),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): write protected canonical data',
      files: {'knowledge/index.md': '# Wiki Index\n'},
    })

    expect(result.committed).toBe(true)
    expect(createBlob).toHaveBeenCalledOnce()
    expect(createTree).toHaveBeenCalledOnce()
    expect(createCommit).toHaveBeenCalledOnce()
    expect(updateRef).toHaveBeenCalledWith(expect.objectContaining({force: false}))
  })

  it('writes to protected data for the canonical repository when protection.enabled is true', async () => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>(async () => ({data: {sha: 'blob-sha'}}))
    const createTree = vi.fn<NonNullable<MockOverrides['createTree']>>(async () => ({data: {sha: 'tree-sha'}}))
    const createCommit = vi.fn<NonNullable<MockOverrides['createCommit']>>(async () => ({data: {sha: 'commit-sha'}}))
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>(async () => ({data: {ref: 'refs/heads/data'}}))

    const result = await commitWikiChanges({
      octokit: createOctokitMock({
        getBranch: async () => ({
          data: {name: 'data', protected: false, protection: {enabled: true}, commit: {sha: 'data-sha'}},
        }),
        createBlob,
        createTree,
        createCommit,
        updateRef,
      }),
      owner: 'fro-bot',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): write protected canonical data',
      files: {'knowledge/index.md': '# Wiki Index\n'},
    })

    expect(result.committed).toBe(true)
    expect(createBlob).toHaveBeenCalledOnce()
    expect(createTree).toHaveBeenCalledOnce()
    expect(createCommit).toHaveBeenCalledOnce()
    expect(updateRef).toHaveBeenCalledWith(expect.objectContaining({force: false}))
  })

  it('propagates GitHub 403 for canonical protected data without retrying', async () => {
    const denial = Object.assign(new Error('Forbidden'), {status: 403})
    const getBranch = vi.fn(async () => ({
      data: {name: 'data', protected: true, commit: {sha: 'data-sha'}},
    }))
    const getRef = vi.fn(async () => ({data: {object: {sha: 'head-sha'}}}))
    const createBlob = vi.fn(async () => ({data: {sha: 'blob-sha'}}))
    const createTree = vi.fn(async () => ({data: {sha: 'tree-sha'}}))
    const createCommit = vi.fn(async () => ({data: {sha: 'commit-sha'}}))
    const updateRef = vi.fn(async () => {
      throw denial
    })
    const bootstrapDataBranch = vi.fn(async () => ({created: false, ref: 'refs/heads/data', sha: 'data-sha'}))

    await expect(
      commitWikiChanges({
        octokit: createOctokitMock({getBranch, getRef, createBlob, createTree, createCommit, updateRef}),
        owner: 'fro-bot',
        repo: '.github',
        branch: 'data',
        message: 'feat(knowledge): protected write denied',
        files: {'knowledge/index.md': '# Wiki Index\n'},
        bootstrapDataBranch,
      }),
    ).rejects.toBe(denial)

    expect(bootstrapDataBranch).toHaveBeenCalledOnce()
    expect(getBranch).toHaveBeenCalledOnce()
    expect(getRef).toHaveBeenCalledOnce()
    expect(createBlob).toHaveBeenCalledOnce()
    expect(createTree).toHaveBeenCalledOnce()
    expect(createCommit).toHaveBeenCalledOnce()
    expect(updateRef).toHaveBeenCalledOnce()
  })

  it.each([
    {name: 'protected is true', branchProtection: {protected: true, protection: {enabled: false}}},
    {name: 'protection.enabled is true', branchProtection: {protected: false, protection: {enabled: true}}},
  ])('rejects protected non-data wiki targets when $name', async ({branchProtection}) => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>()
    const createTree = vi.fn<NonNullable<MockOverrides['createTree']>>()
    const createCommit = vi.fn<NonNullable<MockOverrides['createCommit']>>()
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>()
    const error = await commitWikiChanges({
      octokit: createOctokitMock({
        getBranch: async () => ({data: {name: 'protected-data', ...branchProtection}}),
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

  it('rejects protected data for a noncanonical repository before creating git objects', async () => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>()
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>()

    const error = await commitWikiChanges({
      octokit: createOctokitMock({
        getBranch: async () => ({data: {name: 'data', protected: true, protection: {enabled: false}}}),
        createBlob,
        updateRef,
      }),
      owner: 'someone-else',
      repo: '.github',
      branch: 'data',
      message: 'feat(knowledge): reject noncanonical protected target',
      files: {'knowledge/index.md': '# Wiki Index\n'},
      bootstrapDataBranch: async () => ({created: false, ref: 'refs/heads/data', sha: 'data-sha'}),
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(WikiIngestError)
    expect((error as InstanceType<typeof WikiIngestError>).code).toBe('PROTECTED_BRANCH')
    expect(createBlob).not.toHaveBeenCalled()
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('rejects protected data for a repository override before creating git objects', async () => {
    const createBlob = vi.fn<NonNullable<MockOverrides['createBlob']>>()
    const updateRef = vi.fn<NonNullable<MockOverrides['updateRef']>>()

    const error = await commitWikiChanges({
      octokit: createOctokitMock({
        getBranch: async () => ({data: {name: 'data', protected: true, protection: {enabled: false}}}),
        createBlob,
        updateRef,
      }),
      owner: 'fro-bot',
      repo: 'other-repo',
      branch: 'data',
      message: 'feat(knowledge): reject repository override',
      files: {'knowledge/index.md': '# Wiki Index\n'},
      bootstrapDataBranch: async () => ({created: false, ref: 'refs/heads/data', sha: 'data-sha'}),
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(WikiIngestError)
    expect((error as InstanceType<typeof WikiIngestError>).code).toBe('PROTECTED_BRANCH')
    expect(createBlob).not.toHaveBeenCalled()
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

describe('commitWikiChanges (422 handling)', () => {
  interface UpdateRefParams {
    owner: string
    repo: string
    ref: string
    sha: string
    force: false
  }

  const notFastForward = (): Error => Object.assign(new Error('Update is not a fast forward'), {status: 422})

  const baseParams = {
    owner: 'fro-bot',
    repo: '.github',
    branch: 'data',
    message: 'feat(knowledge): ingest',
    files: {'knowledge/index.md': '# Wiki Index\n'},
  }

  it('retries an updateRef 422 on a re-read tip and lands the commit', async () => {
    // #given the first ref update is rejected as not a fast forward (the branch moved after the tip read)
    vi.useFakeTimers()
    const getRef = vi
      .fn<(params: {owner: string; repo: string; ref: string}) => Promise<{data: {object: {sha: string}}}>>()
      .mockResolvedValueOnce({data: {object: {sha: 'old-tip'}}})
      .mockResolvedValueOnce({data: {object: {sha: 'new-tip'}}})
    const getCommit = vi.fn(async (params: {commit_sha: string}) => ({
      data: {sha: params.commit_sha, tree: {sha: `tree-of-${params.commit_sha}`}},
    }))
    const createTree = vi.fn(async (_params: {base_tree: string}) => ({data: {sha: 'tree-after-write'}}))
    const createCommit = vi.fn(async (_params: {parents: string[]}) => ({data: {sha: 'commit-after-write'}}))
    const updateRef = vi
      .fn<(params: UpdateRefParams) => Promise<unknown>>()
      .mockRejectedValueOnce(notFastForward())
      .mockResolvedValueOnce({data: {ref: 'refs/heads/data'}})

    try {
      const resultPromise = commitWikiChanges({
        ...baseParams,
        octokit: createOctokitMock({getRef, getCommit, createTree, createCommit, updateRef}),
        maxRetries: 3,
      })

      // #when the retry delay elapses
      await vi.advanceTimersByTimeAsync(3000)
      const result = await resultPromise

      // #then the second attempt rebuilds on the new tip and the replayed files land
      expect(result).toEqual({committed: true, commitSha: 'commit-after-write', attempts: 2})
      expect(updateRef).toHaveBeenCalledTimes(2)
      expect(createTree.mock.calls.map(([params]) => params.base_tree)).toEqual(['tree-of-old-tip', 'tree-of-new-tip'])
      expect(createCommit.mock.calls.map(([params]) => params.parents)).toEqual([['old-tip'], ['new-tip']])
    } finally {
      vi.useRealTimers()
    }
  })

  it('raises CONFLICT_EXHAUSTED after every attempt hits an updateRef 422', async () => {
    vi.useFakeTimers()
    const updateRef = vi.fn<(params: UpdateRefParams) => Promise<unknown>>().mockRejectedValue(notFastForward())

    try {
      // #given a ref update that is never a fast forward
      const resultPromise = commitWikiChanges({
        ...baseParams,
        octokit: createOctokitMock({updateRef}),
        maxRetries: 3,
      })
      const assertion = expect(resultPromise).rejects.toMatchObject({code: 'CONFLICT_EXHAUSTED'})

      // #when the whole bound is consumed
      await vi.advanceTimersByTimeAsync(30_000)

      // #then it fails with the conflict exhaustion error after exactly the bound
      await assertion
      expect(updateRef).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry a createTree 422', async () => {
    const createTree = vi.fn(async () => {
      throw Object.assign(new Error('Validation failed'), {status: 422})
    })
    const updateRef = vi.fn<(params: UpdateRefParams) => Promise<unknown>>()

    // #given a tree rejected as invalid
    const action = commitWikiChanges({
      ...baseParams,
      octokit: createOctokitMock({createTree, updateRef}),
      maxRetries: 3,
    })

    // #then the original error bubbles at once, with no retry and no ref update
    await expect(action).rejects.toMatchObject({status: 422})
    expect(createTree).toHaveBeenCalledTimes(1)
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('does not retry a createCommit 422', async () => {
    const createCommit = vi.fn(async () => {
      throw Object.assign(new Error('Validation failed'), {status: 422})
    })
    const updateRef = vi.fn<(params: UpdateRefParams) => Promise<unknown>>()

    const action = commitWikiChanges({
      ...baseParams,
      octokit: createOctokitMock({createCommit, updateRef}),
      maxRetries: 3,
    })

    await expect(action).rejects.toMatchObject({status: 422})
    expect(createCommit).toHaveBeenCalledTimes(1)
    expect(updateRef).not.toHaveBeenCalled()
  })
})

describe('commitWikiChanges (guarded replay after a ref race)', () => {
  interface Entry {
    path: string
    mode: string
    type: string
    sha: string
  }

  const entry = (path: string, sha: string, overrides: Partial<Entry> = {}): Entry => ({
    path,
    mode: '100644',
    type: 'blob',
    sha,
    ...overrides,
  })

  /** The head the write was derived from: the files it will replay, plus an unrelated script. */
  const baseEntries = (): Entry[] => [
    entry('knowledge/index.md', 'index-v1'),
    entry('knowledge/log.md', 'log-v1'),
    entry('knowledge/wiki/repos/page.md', 'page-v1'),
    entry('knowledge/wiki/repos/old.md', 'old-v1'),
    entry('scripts/x.ts', 'x-v1'),
    {path: 'knowledge', mode: '040000', type: 'tree', sha: 'dir-sha'},
  ]

  const replace = (entries: Entry[], path: string, next: Entry | undefined): Entry[] => [
    ...entries.filter(candidate => candidate.path !== path),
    ...(next === undefined ? [] : [next]),
  ]

  const files = {
    'knowledge/index.md': '# Wiki Index\n',
    'knowledge/log.md': '# Wiki Log\n',
    'knowledge/wiki/repos/page.md': '# Page\n',
  }

  interface UpdateRefParams {
    owner: string
    repo: string
    ref: string
    sha: string
    force: false
  }

  /**
   * A first attempt that reads `base`, builds, and loses the ref race; the retry then reads
   * `concurrent`, the head another writer moved to.
   */
  function scenario(params: {
    status: 409 | 422
    concurrent: Entry[]
    truncatedConcurrent?: boolean
    deletedPaths?: string[]
  }) {
    const treesBySha: Record<string, {entries: Entry[]; truncated: boolean}> = {
      'tree-base': {entries: baseEntries(), truncated: false},
      'tree-concurrent': {entries: params.concurrent, truncated: params.truncatedConcurrent ?? false},
    }
    const getRef = vi
      .fn<(args: {owner: string; repo: string; ref: string}) => Promise<{data: {object: {sha: string}}}>>()
      .mockResolvedValueOnce({data: {object: {sha: 'tip-base'}}})
      .mockResolvedValue({data: {object: {sha: 'tip-concurrent'}}})
    const getCommit = vi.fn(async (args: {commit_sha: string}) => ({
      data: {
        sha: args.commit_sha,
        tree: {sha: args.commit_sha === 'tip-base' ? 'tree-base' : 'tree-concurrent'},
      },
    }))
    const getTree = vi.fn(async (args: {tree_sha: string}) => {
      const found = treesBySha[args.tree_sha]
      return {data: {truncated: found?.truncated ?? false, tree: found?.entries ?? []}}
    })
    const createBlob = vi.fn(async () => ({data: {sha: 'blob'}}))
    const createTree = vi.fn(async (_args: {base_tree: string}) => ({data: {sha: 'tree-after-write'}}))
    const createCommit = vi.fn(async (_args: {parents: string[]}) => ({data: {sha: 'commit-after-write'}}))
    const updateRef = vi
      .fn<(args: UpdateRefParams) => Promise<unknown>>()
      .mockRejectedValueOnce(Object.assign(new Error('raced'), {status: params.status}))
      .mockResolvedValue({data: {ref: 'refs/heads/data'}})
    const octokit = createOctokitMock({getRef, getCommit, getTree, createBlob, createTree, createCommit, updateRef})

    const run = async () => {
      vi.useFakeTimers()
      try {
        const settled = commitWikiChanges({
          octokit,
          owner: 'fro-bot',
          repo: '.github',
          branch: 'data',
          message: 'feat(knowledge): ingest',
          files,
          deletedPaths: params.deletedPaths,
          maxRetries: 3,
        }).then(
          value => ({value}) as const,
          (error: unknown) => ({error}) as const,
        )
        await vi.advanceTimersByTimeAsync(30_000)
        return await settled
      } finally {
        vi.useRealTimers()
      }
    }
    return {run, createBlob, createTree, createCommit, updateRef}
  }

  it.each([409, 422] as const)(
    'replays on a %i when the concurrent commit changed only an unrelated path (a)',
    async status => {
      // #given a merge-back-style commit that changed scripts/x.ts and nothing in the write set
      const mocks = scenario({
        status,
        concurrent: replace(baseEntries(), 'scripts/x.ts', entry('scripts/x.ts', 'x-v2')),
      })

      // #when the retry runs
      const outcome = await mocks.run()

      // #then the files replay on the new head
      expect(outcome).toMatchObject({value: {committed: true, attempts: 2}})
      expect(mocks.updateRef).toHaveBeenCalledTimes(2)
      expect(mocks.createCommit.mock.calls.map(([args]) => args.parents)).toEqual([['tip-base'], ['tip-concurrent']])
    },
  )

  it.each([409, 422] as const)(
    'fails closed on a %i when the concurrent commit changed knowledge/log.md (b)',
    async status => {
      const mocks = scenario({
        status,
        concurrent: replace(baseEntries(), 'knowledge/log.md', entry('knowledge/log.md', 'log-v2')),
      })

      const outcome = await mocks.run()

      // #then it fails with the conflict error and writes nothing on the retry: the ref stays where the
      // concurrent writer left it, with its log entry
      expect(outcome).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
      expect(mocks.updateRef).toHaveBeenCalledTimes(1)
      expect(mocks.createBlob).toHaveBeenCalledTimes(Object.keys(files).length)
      expect(mocks.createTree).toHaveBeenCalledTimes(1)
      expect(mocks.createCommit).toHaveBeenCalledTimes(1)
    },
  )

  it.each([409, 422] as const)(
    'fails closed on a %i when the concurrent commit changed knowledge/index.md (c)',
    async status => {
      const mocks = scenario({
        status,
        concurrent: replace(baseEntries(), 'knowledge/index.md', entry('knowledge/index.md', 'index-v2')),
      })

      const outcome = await mocks.run()

      expect(outcome).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
      expect(mocks.updateRef).toHaveBeenCalledTimes(1)
      expect(mocks.createCommit).toHaveBeenCalledTimes(1)
    },
  )

  it('fails closed when the concurrent commit changed a page in the write set (d)', async () => {
    const mocks = scenario({
      status: 422,
      concurrent: replace(
        baseEntries(),
        'knowledge/wiki/repos/page.md',
        entry('knowledge/wiki/repos/page.md', 'page-v2'),
      ),
    })

    expect(await mocks.run()).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
    expect(mocks.updateRef).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the concurrent commit created a write-set path that was absent from the base (absence is a value)', async () => {
    const mocks = scenario({
      status: 409,
      deletedPaths: ['knowledge/wiki/repos/ghost.md'],
      concurrent: [...baseEntries(), entry('knowledge/wiki/repos/ghost.md', 'ghost-v1')],
    })

    expect(await mocks.run()).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
    expect(mocks.updateRef).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the concurrent commit removed a write-set path (absence is a value)', async () => {
    const mocks = scenario({status: 409, concurrent: replace(baseEntries(), 'knowledge/log.md', undefined)})

    expect(await mocks.run()).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
    expect(mocks.updateRef).toHaveBeenCalledTimes(1)
  })

  it('compares mode and type, not only the sha', async () => {
    const mocks = scenario({
      status: 409,
      concurrent: replace(baseEntries(), 'knowledge/log.md', entry('knowledge/log.md', 'log-v1', {mode: '100755'})),
    })

    expect(await mocks.run()).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
  })

  it('also guards a path being deleted', async () => {
    const mocks = scenario({
      status: 422,
      deletedPaths: ['knowledge/wiki/repos/old.md'],
      concurrent: replace(baseEntries(), 'knowledge/wiki/repos/old.md', entry('knowledge/wiki/repos/old.md', 'old-v2')),
    })

    expect(await mocks.run()).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
    expect(mocks.updateRef).toHaveBeenCalledTimes(1)
  })

  it('replays when a deleted path is unchanged on the new head', async () => {
    const mocks = scenario({
      status: 422,
      deletedPaths: ['knowledge/wiki/repos/old.md'],
      concurrent: replace(baseEntries(), 'scripts/x.ts', entry('scripts/x.ts', 'x-v2')),
    })

    expect(await mocks.run()).toMatchObject({value: {committed: true, attempts: 2}})
  })

  it('fails closed when a tree read is truncated, because the write set cannot be verified', async () => {
    const mocks = scenario({
      status: 409,
      truncatedConcurrent: true,
      concurrent: replace(baseEntries(), 'scripts/x.ts', entry('scripts/x.ts', 'x-v2')),
    })

    expect(await mocks.run()).toMatchObject({error: {code: 'CONFLICT_EXHAUSTED'}})
    expect(mocks.updateRef).toHaveBeenCalledTimes(1)
  })
})

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error,
  )
}

describe('commitWikiChanges (base guard on every attempt)', () => {
  interface Entry {
    path: string
    mode: string
    type: string
    sha: string
  }

  const entry = (path: string, sha: string): Entry => ({path, mode: '100644', type: 'blob', sha})

  const baseEntries = (): Entry[] => [
    entry('knowledge/index.md', 'index-v1'),
    entry('knowledge/log.md', 'log-v1'),
    entry('knowledge/wiki/repos/page.md', 'page-v1'),
    entry('scripts/x.ts', 'x-v1'),
  ]

  const withEntry = (entries: Entry[], next: Entry): Entry[] => [
    ...entries.filter(candidate => candidate.path !== next.path),
    next,
  ]

  const files = {'knowledge/index.md': '# Wiki Index\n', 'knowledge/log.md': '# Wiki Log\n'}

  /**
   * Commits by SHA name `tip-<name>`, trees `tree-<name>`; `main` is `tip-main`. `head` is what the
   * commit's first `getRef` for `data` returns, which may already be past the base.
   */
  function world(params: {head: 'base' | 'concurrent'; concurrent: Entry[]; mainTip?: Entry[]}) {
    const trees: Record<string, Entry[]> = {
      'tree-base': baseEntries(),
      'tree-concurrent': params.concurrent,
      'tree-main': params.mainTip ?? baseEntries(),
    }
    const getRef = vi.fn(async (args: {ref: string}) => ({
      data: {object: {sha: args.ref === 'heads/main' ? 'tip-main' : `tip-${params.head}`}},
    }))
    const getCommit = vi.fn(async (args: {commit_sha: string}) => ({
      data: {sha: args.commit_sha, tree: {sha: `tree-${args.commit_sha.replace('tip-', '')}`}},
    }))
    const getTree = vi.fn(async (args: {tree_sha: string}) => ({
      data: {truncated: false, tree: trees[args.tree_sha] ?? []},
    }))
    const createBlob = vi.fn(async () => ({data: {sha: 'blob'}}))
    const createTree = vi.fn(async (_args: {base_tree: string}) => ({data: {sha: 'tree-after-write'}}))
    const createCommit = vi.fn(async (_args: {parents: string[]}) => ({data: {sha: 'commit-after-write'}}))
    const updateRef = vi.fn(async (_args: {sha: string}) => ({data: {ref: 'refs/heads/data'}}))
    const octokit = createOctokitMock({getRef, getCommit, getTree, createBlob, createTree, createCommit, updateRef})
    const commit = async (extra: {baseCommitSha?: string} = {}) =>
      commitWikiChanges({
        octokit,
        owner: 'fro-bot',
        repo: '.github',
        branch: 'data',
        message: 'feat(knowledge): ingest',
        files,
        maxRetries: 3,
        ...extra,
      })
    const writes = () =>
      createBlob.mock.calls.length +
      createTree.mock.calls.length +
      createCommit.mock.calls.length +
      updateRef.mock.calls.length
    return {commit, getTree, getCommit, createCommit, updateRef, writes}
  }

  it('succeeds on a clean first attempt when the head is the base, without reading any tree', async () => {
    const w = world({head: 'base', concurrent: baseEntries()})

    const result = await w.commit({baseCommitSha: 'tip-base'})

    expect(result).toMatchObject({committed: true, attempts: 1})
    expect(w.getTree).not.toHaveBeenCalled()
    expect(w.createCommit.mock.calls[0]?.[0].parents).toEqual(['tip-base'])
  })

  it('fails closed on attempt 1, writing nothing, when a writer changed knowledge/log.md after the base', async () => {
    // #given a commit landed between the files being derived (tip-base) and the first read
    const w = world({head: 'concurrent', concurrent: withEntry(baseEntries(), entry('knowledge/log.md', 'log-v2'))})

    // #when the write runs with its base
    const error = await rejectionOf(w.commit({baseCommitSha: 'tip-base'}))

    // #then it fails with the conflict error before creating a blob, tree, commit or ref update
    expect(error).toMatchObject({code: 'CONFLICT_EXHAUSTED'})
    expect(w.writes()).toBe(0)
  })

  it('fails closed on attempt 1 when a writer changed knowledge/index.md after the base', async () => {
    const w = world({head: 'concurrent', concurrent: withEntry(baseEntries(), entry('knowledge/index.md', 'index-v2'))})

    expect(await rejectionOf(w.commit({baseCommitSha: 'tip-base'}))).toMatchObject({
      code: 'CONFLICT_EXHAUSTED',
    })
    expect(w.writes()).toBe(0)
  })

  it('replays on attempt 1 when the commit after the base touched only an unowned path (merge-back style)', async () => {
    const w = world({head: 'concurrent', concurrent: withEntry(baseEntries(), entry('scripts/x.ts', 'x-v2'))})

    const result = await w.commit({baseCommitSha: 'tip-base'})

    expect(result).toMatchObject({committed: true, attempts: 1})
    expect(w.createCommit.mock.calls[0]?.[0].parents).toEqual(['tip-concurrent'])
  })

  it('keeps the old behavior without a base: the first read is the base, so a head already past it is replayed', async () => {
    // #given no base is passed and the head already carries a different log
    const w = world({head: 'concurrent', concurrent: withEntry(baseEntries(), entry('knowledge/log.md', 'log-v2'))})

    // #when the write runs
    const result = await w.commit()

    // #then it lands on that head, with no tree comparison at all
    expect(result).toMatchObject({committed: true, attempts: 1})
    expect(w.getTree).not.toHaveBeenCalled()
  })

  it('keeps an SHA base fixed across retries: a concurrent write that is later promoted is still rejected', async () => {
    // #given attempt 1 reads the base head and loses the ref race; a writer then changes log.md, and the
    // change is promoted, so both the data head and main now carry it
    vi.useFakeTimers()
    const trees: Record<string, Entry[]> = {
      'tree-base': baseEntries(),
      'tree-promoted': withEntry(baseEntries(), entry('knowledge/log.md', 'log-v2')),
    }
    const getRef = vi.fn(async (args: {ref: string}) => {
      if (args.ref === 'heads/main') return {data: {object: {sha: 'tip-promoted'}}}
      return {
        data: {
          object: {
            sha: getRef.mock.calls.filter(([a]) => a.ref === 'heads/data').length === 1 ? 'tip-base' : 'tip-promoted',
          },
        },
      }
    })
    const getCommit = vi.fn(async (args: {commit_sha: string}) => ({
      data: {sha: args.commit_sha, tree: {sha: `tree-${args.commit_sha.replace('tip-', '')}`}},
    }))
    const getTree = vi.fn(async (args: {tree_sha: string}) => ({
      data: {truncated: false, tree: trees[args.tree_sha] ?? []},
    }))
    const createCommit = vi.fn(async (_args: {parents: string[]}) => ({data: {sha: 'commit-after-write'}}))
    const updateRef = vi
      .fn<(args: {sha: string}) => Promise<unknown>>()
      .mockRejectedValueOnce(Object.assign(new Error('raced'), {status: 409}))
      .mockResolvedValue({data: {ref: 'refs/heads/data'}})
    const octokit = createOctokitMock({getRef, getCommit, getTree, createCommit, updateRef})

    try {
      const settled = rejectionOf(
        commitWikiChanges({
          octokit,
          owner: 'fro-bot',
          repo: '.github',
          branch: 'data',
          message: 'feat(knowledge): ingest',
          files,
          baseCommitSha: 'tip-base',
          maxRetries: 3,
        }),
      )
      await vi.advanceTimersByTimeAsync(30_000)

      // #then the retry rejects against the original base and the concurrent content is not overwritten
      expect(await settled).toMatchObject({code: 'CONFLICT_EXHAUSTED'})
      expect(updateRef).toHaveBeenCalledTimes(1)
      expect(createCommit).toHaveBeenCalledTimes(1)
      // the base commit is resolved once (plus the one head read of it) and main is never consulted
      expect(getCommit.mock.calls.filter(([args]) => args.commit_sha === 'tip-base')).toHaveLength(2)
      expect(getRef.mock.calls.some(([args]) => args.ref === 'heads/main')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('runWikiIngestCli (base from the synced data tip)', () => {
  const originalCwd = process.cwd()
  const originalTip = process.env.WIKI_INGEST_DATA_TIP_SHA
  const page = createWikiPage({path: 'knowledge/wiki/repos/alice--project.md', type: 'repo', title: 'alice/project'})

  function inTempWiki(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wiki-ingest-cli-'))
    mkdirSync(join(dir, 'knowledge/wiki/repos'), {recursive: true})
    writeFileSync(join(dir, page.path), page.content)
    process.chdir(dir)
    return dir
  }

  async function run() {
    const commit = vi.fn(async (_params: Record<string, unknown>) => ({committed: true, commitSha: 'c', attempts: 1}))
    await runWikiIngestCli({
      readCorrections: async () => ({corrections: {version: 1, corrections: []}, warnings: []}),
      getChangedWikiPaths: async () => [page.path],
      commitWikiChanges: commit as never,
    })
    return commit
  }

  function restore(dir: string): void {
    process.chdir(originalCwd)
    rmSync(dir, {recursive: true, force: true})
    if (originalTip === undefined) delete process.env.WIKI_INGEST_DATA_TIP_SHA
    else process.env.WIKI_INGEST_DATA_TIP_SHA = originalTip
  }

  it('passes the recorded tip as the commit base', async () => {
    const dir = inTempWiki()
    process.env.WIKI_INGEST_DATA_TIP_SHA = 'synced-tip'
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const commit = await run()
      expect(commit.mock.calls[0]?.[0]).toMatchObject({baseCommitSha: 'synced-tip'})
    } finally {
      vi.restoreAllMocks()
      restore(dir)
    }
  })

  it.each([undefined, ''])('passes no base key when the tip is %j', async tip => {
    const dir = inTempWiki()
    if (tip === undefined) delete process.env.WIKI_INGEST_DATA_TIP_SHA
    else process.env.WIKI_INGEST_DATA_TIP_SHA = tip
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const commit = await run()
      expect(commit.mock.calls[0]?.[0]).not.toHaveProperty('baseCommitSha')
    } finally {
      vi.restoreAllMocks()
      restore(dir)
    }
  })
})

const LOG_HEADER_TEXT =
  '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n'

function logEntryText(n: number): string {
  return `\n## [2026-10-20 10:0${n}] ingest | repo:acme/app-${n}\n\nDetail ${n}.\n\nSources: none\n`
}

const SUMMARY_ENTRY_TEXT =
  '\n## [2026-10-21 09:00] ingest | repo:acme/target\n\nSurveyed acme/target.\n\nSources: none\n'

describe('deriveAgentLogEntries', () => {
  const base = `${LOG_HEADER_TEXT}${logEntryText(1)}`

  it('returns the text the handoff log adds after the base log', () => {
    expect(deriveAgentLogEntries(base, `${base}${logEntryText(2)}`)).toBe(logEntryText(2))
  })

  it('returns every appended entry, in order', () => {
    expect(deriveAgentLogEntries(base, `${base}${logEntryText(2)}${logEntryText(3)}`)).toBe(
      `${logEntryText(2)}${logEntryText(3)}`,
    )
  })

  it('returns an empty string when the handoff log equals the base log', () => {
    expect(deriveAgentLogEntries(base, base)).toBe('')
  })

  it('normalizes CRLF line endings and a missing final newline before comparing', () => {
    const handoff = `${base}${logEntryText(2)}`.replaceAll('\n', '\r\n').trimEnd()

    expect(deriveAgentLogEntries(base, handoff)).toBe(logEntryText(2))
  })

  it('returns undefined when the agent changed text before the base log ends', () => {
    const rewritten = base.replace('Detail 1.', 'Detail 1, rewritten.')

    expect(deriveAgentLogEntries(base, `${rewritten}${logEntryText(2)}`)).toBeUndefined()
  })

  it('returns undefined when the handoff log is shorter than the base log', () => {
    expect(deriveAgentLogEntries(base, LOG_HEADER_TEXT)).toBeUndefined()
  })

  it('returns undefined when the base log is empty, since there is no anchor to measure from', () => {
    expect(deriveAgentLogEntries('', base)).toBeUndefined()
  })
})

describe('buildWikiIngestChanges (agent log entries)', () => {
  const page = createWikiPage({path: 'knowledge/wiki/topics/notes.md', type: 'topic', title: 'Notes'})
  const params = {
    operation: 'survey' as const,
    target: 'repo:acme/target',
    summary: 'Surveyed acme/target.',
    timestamp: new Date('2026-10-21T09:00:00Z'),
    sources: [],
    pages: [page],
  }

  it('appends the agent entries to the existing log before the summary entry, keeping existing text', () => {
    const existingLog = `${LOG_HEADER_TEXT}${logEntryText(1)}`

    const result = buildWikiIngestChanges({
      ...params,
      existingFiles: {...createEmptyWikiFiles(), 'knowledge/log.md': existingLog},
      agentLogEntries: `${logEntryText(2)}${logEntryText(3)}`,
    })

    expect(result.files['knowledge/log.md']).toBe(
      `${existingLog}${logEntryText(2)}${logEntryText(3)}${SUMMARY_ENTRY_TEXT}`,
    )
  })

  it.each([undefined, ''])('appends only the summary entry when the agent entries are %j', agentLogEntries => {
    const existingLog = `${LOG_HEADER_TEXT}${logEntryText(1)}`

    const result = buildWikiIngestChanges({
      ...params,
      existingFiles: {...createEmptyWikiFiles(), 'knowledge/log.md': existingLog},
      agentLogEntries,
    })

    expect(result.files['knowledge/log.md']).toBe(`${existingLog}${SUMMARY_ENTRY_TEXT}`)
  })

  it('starts from the log header when no log exists yet', () => {
    const result = buildWikiIngestChanges({
      ...params,
      existingFiles: {'knowledge/index.md': '# Wiki Index\n'},
      agentLogEntries: logEntryText(2),
    })

    expect(result.files['knowledge/log.md']).toBe(`${LOG_HEADER_TEXT}${logEntryText(2)}${SUMMARY_ENTRY_TEXT}`)
  })
})

describe('runWikiIngestCli (agent log entries from a handoff)', () => {
  const originalCwd = process.cwd()
  const envKeys = [
    'WIKI_INGEST_DATA_TIP_SHA',
    'WIKI_HANDOFF_DIR',
    'WIKI_HANDOFF_BASE_SHA',
    'WIKI_OPERATION',
    'WIKI_TARGET',
    'WIKI_SUMMARY',
    'WIKI_TIMESTAMP',
    'WIKI_OWNER',
    'WIKI_REPO',
  ]
  const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]))
  const page = createWikiPage({path: 'knowledge/wiki/topics/notes.md', type: 'topic', title: 'Notes'})
  const agentSha = 'a'.repeat(40)
  const syncedLog = `${LOG_HEADER_TEXT}${logEntryText(1)}`
  let dir: string
  let stderr: string[]

  /** A trusted-job workspace: `log.md` as synced from `data`, the applied page, and the downloaded handoff. */
  function setUp(params: {handoffLog?: string; manifestChanged?: string[]; baseSha?: string}): string {
    dir = mkdtempSync(join(tmpdir(), 'wiki-ingest-handoff-'))
    mkdirSync(join(dir, 'knowledge/wiki/topics'), {recursive: true})
    writeFileSync(join(dir, page.path), page.content)
    writeFileSync(join(dir, 'knowledge/log.md'), syncedLog)
    writeFileSync(join(dir, 'knowledge/index.md'), '# Wiki Index\n')
    const handoffDir = join(dir, '.handoff')
    mkdirSync(join(handoffDir, 'files/knowledge'), {recursive: true})
    const changed = params.manifestChanged ?? [
      page.path,
      ...(params.handoffLog === undefined ? [] : ['knowledge/log.md']),
    ]
    writeFileSync(join(handoffDir, 'manifest.json'), JSON.stringify({changed, deleted: []}))
    if (params.handoffLog !== undefined) writeFileSync(join(handoffDir, 'files/knowledge/log.md'), params.handoffLog)
    process.chdir(dir)
    process.env.WIKI_HANDOFF_DIR = handoffDir
    process.env.WIKI_HANDOFF_BASE_SHA = params.baseSha ?? agentSha
    process.env.WIKI_OPERATION = 'survey'
    process.env.WIKI_TARGET = 'repo:acme/target'
    process.env.WIKI_SUMMARY = 'Surveyed acme/target.'
    process.env.WIKI_TIMESTAMP = '2026-10-21T09:00:00Z'
    delete process.env.WIKI_INGEST_DATA_TIP_SHA
    return handoffDir
  }

  /** Answers the reads of `log.md` at the agent commit: the file's text, no file, or a failing API. */
  function octokitReading(baseLog: string | undefined | Error): OctokitClient {
    const entries = baseLog instanceof Error || baseLog === undefined ? [] : [{path: 'knowledge/log.md'}]
    return {
      rest: {
        git: {
          getCommit: async () => {
            if (baseLog instanceof Error) throw baseLog
            return {data: {sha: agentSha, tree: {sha: 'agent-tree'}}}
          },
          getTree: async () => ({
            data: {
              truncated: false,
              tree: entries.map(entry => ({...entry, type: 'blob', mode: '100644', sha: 'log-blob'})),
            },
          }),
          getBlob: async () => ({
            data: {content: Buffer.from(typeof baseLog === 'string' ? baseLog : '', 'utf8').toString('base64')},
          }),
        },
      },
    } as unknown as OctokitClient
  }

  async function run(octokit: OctokitClient) {
    const commit = vi.fn(async (_params: Record<string, unknown>) => ({committed: true, commitSha: 'c', attempts: 1}))
    await runWikiIngestCli({
      readCorrections: async () => ({corrections: {version: 1, corrections: []}, warnings: []}),
      getChangedWikiPaths: async () => [page.path],
      commitWikiChanges: commit as never,
      octokit,
    })
    return commit
  }

  const committedLog = (commit: Awaited<ReturnType<typeof run>>): string =>
    (commit.mock.calls[0]?.[0].files as Record<string, string>)['knowledge/log.md'] ?? ''

  beforeEach(() => {
    stderr = []
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.chdir(originalCwd)
    rmSync(dir, {recursive: true, force: true})
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('commits the synced log, the entry the agent appended, then the summary entry', async () => {
    setUp({handoffLog: `${syncedLog}${logEntryText(2)}`})

    const commit = await run(octokitReading(syncedLog))

    expect(committedLog(commit)).toBe(`${syncedLog}${logEntryText(2)}${SUMMARY_ENTRY_TEXT}`)
    expect(stderr.join('')).not.toContain('agent-log-entries-dropped')
  })

  it('keeps every entry the agent appended, in order', async () => {
    setUp({handoffLog: `${syncedLog}${logEntryText(2)}${logEntryText(3)}`})

    const commit = await run(octokitReading(syncedLog))

    expect(committedLog(commit)).toBe(`${syncedLog}${logEntryText(2)}${logEntryText(3)}${SUMMARY_ENTRY_TEXT}`)
  })

  it('keeps entries that another writer committed after the agent synced', async () => {
    // #given the synced log already carries entry 2, which the agent never saw
    const synced = `${syncedLog}${logEntryText(2)}`
    setUp({handoffLog: `${syncedLog}${logEntryText(3)}`})
    writeFileSync(join(dir, 'knowledge/log.md'), synced)

    // #when the agent's base log is the older log
    const commit = await run(octokitReading(syncedLog))

    // #then the synced entry stays, and the agent's entry follows it
    expect(committedLog(commit)).toBe(`${synced}${logEntryText(3)}${SUMMARY_ENTRY_TEXT}`)
  })

  it('appends only the summary entry when the handoff log equals the base log', async () => {
    setUp({handoffLog: syncedLog})

    const commit = await run(octokitReading(syncedLog))

    expect(committedLog(commit)).toBe(`${syncedLog}${SUMMARY_ENTRY_TEXT}`)
  })

  it('appends only the summary entry when the handoff carries no log', async () => {
    setUp({})

    const commit = await run(octokitReading(syncedLog))

    expect(committedLog(commit)).toBe(`${syncedLog}${SUMMARY_ENTRY_TEXT}`)
  })

  it('keeps the agent entry when the handoff log uses CRLF line endings and has no final newline', async () => {
    setUp({handoffLog: `${syncedLog}${logEntryText(2)}`.replaceAll('\n', '\r\n').trimEnd()})

    const commit = await run(octokitReading(syncedLog))

    expect(committedLog(commit)).toBe(`${syncedLog}${logEntryText(2)}${SUMMARY_ENTRY_TEXT}`)
  })

  it('drops the agent entries with a warning when the agent rewrote an earlier entry', async () => {
    setUp({handoffLog: `${syncedLog.replace('Detail 1.', 'Detail 1, rewritten.')}${logEntryText(2)}`})

    const commit = await run(octokitReading(syncedLog))

    expect(committedLog(commit)).toBe(`${syncedLog}${SUMMARY_ENTRY_TEXT}`)
    expect(stderr.join('')).toContain(
      `wiki-ingest:warning:${JSON.stringify({code: 'agent-log-entries-dropped', reason: 'not-append-only'})}`,
    )
  })

  it('drops the agent entries with a warning when the agent commit has no log to measure from', async () => {
    setUp({handoffLog: `${syncedLog}${logEntryText(2)}`})

    const commit = await run(octokitReading(undefined))

    expect(committedLog(commit)).toBe(`${syncedLog}${SUMMARY_ENTRY_TEXT}`)
    expect(stderr.join('')).toContain(
      `wiki-ingest:warning:${JSON.stringify({code: 'agent-log-entries-dropped', reason: 'base-log-missing'})}`,
    )
  })

  it('refuses without committing when the log at the agent commit cannot be read', async () => {
    setUp({handoffLog: `${syncedLog}${logEntryText(2)}`})
    const commit = vi.fn()

    const error = await rejectionOf(
      runWikiIngestCli({
        readCorrections: async () => ({corrections: {version: 1, corrections: []}, warnings: []}),
        getChangedWikiPaths: async () => [page.path],
        commitWikiChanges: commit as never,
        octokit: octokitReading(Object.assign(new Error('boom'), {status: 500})),
      }),
    )

    expect(error).toMatchObject({code: 'HANDOFF_BASE_INVALID'})
    expect(commit).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['malformed', 'not-a-sha'],
    ['abbreviated', 'abc1234'],
  ])('refuses a %s agent commit before reading anything', async (_name, baseSha) => {
    setUp({handoffLog: `${syncedLog}${logEntryText(2)}`, baseSha})
    const commit = vi.fn()

    const error = await rejectionOf(
      runWikiIngestCli({
        readCorrections: async () => ({corrections: {version: 1, corrections: []}, warnings: []}),
        getChangedWikiPaths: async () => [page.path],
        commitWikiChanges: commit as never,
        octokit: octokitReading(syncedLog),
      }),
    )

    expect(error).toMatchObject({code: 'HANDOFF_BASE_INVALID'})
    expect(commit).not.toHaveBeenCalled()
  })

  it('refuses a handoff directory with no agent commit', async () => {
    setUp({})
    delete process.env.WIKI_HANDOFF_BASE_SHA

    const error = await rejectionOf(run(octokitReading(syncedLog)))

    expect(error).toMatchObject({code: 'HANDOFF_BASE_INVALID'})
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

describe('validateWikilinks', () => {
  const page = (body: string): string =>
    ['---', 'type: topic', 'title: Page', 'created: 2026-10-01', 'updated: 2026-10-01', '---', '', body, ''].join('\n')
  const filesWith = (body: string): Record<string, string> => ({
    'knowledge/wiki/topics/page.md': page(body),
    'knowledge/wiki/topics/known.md': page('Known.'),
  })

  it('rejects a live wikilink to a missing page', () => {
    expect(() => validateWikilinks(filesWith('See [[ghost]].'))).toThrow('[[ghost]]')
  })

  it('ignores a missing-page wikilink inside inline code', () => {
    expect(() => validateWikilinks(filesWith('Write `[[ghost]]` or ``[[ghost|a ` b]]`` to link.'))).not.toThrow()
  })

  it('ignores a missing-page wikilink inside a fenced code block', () => {
    expect(() => validateWikilinks(filesWith(['```md', '[[ghost]]', '```'].join('\n')))).not.toThrow()
  })

  it('still checks a real wikilink next to a code span', () => {
    expect(() => validateWikilinks(filesWith('`[[ghost]]` then [[known]].'))).not.toThrow()
    expect(() => validateWikilinks(filesWith('`[[known]]` then [[ghost]].'))).toThrow('[[ghost]]')
  })

  it('still checks the target of an aliased wikilink outside code', () => {
    expect(() => validateWikilinks(filesWith('See [[known|Known page]].'))).not.toThrow()
    expect(() => validateWikilinks(filesWith('See [[ghost|Known page]].'))).toThrow('[[ghost]]')
  })
})
