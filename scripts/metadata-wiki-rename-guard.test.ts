import type {OctokitClient} from './commit-metadata.ts'

import {describe, expect, it, vi} from 'vitest'

import {
  evaluateRenameGuard,
  findRemovedPublicSlugs,
  lookupRepoWikiPage,
  REPOS_METADATA_PATH,
  type WikiPageState,
} from './metadata-wiki-rename-guard.ts'

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner: 'acme',
    name: 'widget',
    added: '2026-01-01',
    onboarding_status: 'onboarded',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: false,
    has_renovate: false,
    private: false,
    ...overrides,
  }
}

function file(...repos: Record<string, unknown>[]): {version: 1; repos: Record<string, unknown>[]} {
  return {version: 1, repos}
}

function apiError(status: number, message = 'API error'): Error {
  return Object.assign(new Error(message), {status})
}

describe('REPOS_METADATA_PATH', () => {
  it('is the exact path the guard applies to', () => {
    expect(REPOS_METADATA_PATH).toBe('metadata/repos.yaml')
  })
})

describe('findRemovedPublicSlugs', () => {
  it('reports nothing when the public name set is unchanged', () => {
    const state = file(row({node_id: 'R_widget'}))

    expect(findRemovedPublicSlugs(state, structuredClone(state))).toEqual([])
  })

  it('reports the old name of a single-row rename', () => {
    const previous = file(row({name: 'old-widget', node_id: 'R_widget'}))
    const next = file(row({name: 'new-widget', node_id: 'R_widget'}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual(['acme--old-widget'])
  })

  it('reports the dropped name of a duplicate-row merge', () => {
    const previous = file(
      row({name: 'new-widget', node_id: 'R_widget'}),
      row({name: 'old-widget', node_id: 'R_widget'}),
    )
    const next = file(row({name: 'new-widget', node_id: 'R_widget'}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual(['acme--old-widget'])
  })

  it('reports an ID-less old row that disappears (no identity to prove a downgrade)', () => {
    const previous = file(row({name: 'old-widget'}))
    const next = file(row({name: 'new-widget', node_id: 'R_widget'}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual(['acme--old-widget'])
  })

  it('reports a rename whose successor carries a different stable identity', () => {
    const previous = file(row({name: 'old-widget', node_id: 'R_old'}))
    const next = file(row({name: 'new-widget', node_id: 'R_other'}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual(['acme--old-widget'])
  })

  it('reports a name that matches only by database_id', () => {
    const previous = file(row({name: 'old-widget', database_id: 42}))
    const next = file(row({name: 'new-widget', database_id: 42}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual(['acme--old-widget'])
  })

  it('reports a public row that vanishes entirely', () => {
    expect(findRemovedPublicSlugs(file(row({node_id: 'R_widget'})), file())).toEqual(['acme--widget'])
  })

  it('does not report a visibility downgrade to private (redacted form)', () => {
    const previous = file(row({node_id: 'R_widget'}))
    const next = file(row({owner: '[REDACTED]', name: 'R_widget', private: true, node_id: 'R_widget'}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual([])
  })

  it('does not report a downgrade to unknown visibility', () => {
    const previous = file(row({node_id: 'R_widget'}))
    const next = file(row({node_id: 'R_widget', private: undefined}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual([])
  })

  it('does not report an ID-less downgrade that keeps the same name', () => {
    const previous = file(row())
    const next = file(row({private: true}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual([])
  })

  it('matches a legacy redacted successor by the node ID stored in name', () => {
    const previous = file(row({node_id: 'R_widget'}))
    const next = file({...row({private: true}), owner: '[REDACTED]', name: 'R_widget', node_id: undefined})

    expect(findRemovedPublicSlugs(previous, next)).toEqual([])
  })

  it('still reports the removal when a rename is combined with a downgrade of a different duplicate', () => {
    const previous = file(row({name: 'old-widget', node_id: 'R_widget'}))
    const next = file(
      row({name: 'new-widget', node_id: 'R_widget'}),
      row({owner: '[REDACTED]', name: 'R_widget', private: true, node_id: 'R_widget'}),
    )

    expect(findRemovedPublicSlugs(previous, next)).toEqual(['acme--old-widget'])
  })

  it('does not report names that were never public', () => {
    const previous = file(row({name: 'quiet', private: undefined}), row({name: 'hidden', private: true}))

    expect(findRemovedPublicSlugs(previous, file())).toEqual([])
  })

  it('treats a non-boolean private flag as not public', () => {
    const previous = file(row({private: 'false'}))

    expect(findRemovedPublicSlugs(previous, file())).toEqual([])
  })

  it('fails closed on a malformed proposed file by reporting every public name as removed', () => {
    const previous = file(row({node_id: 'R_widget'}))

    expect(findRemovedPublicSlugs(previous, 'not a repos file')).toEqual(['acme--widget'])
    expect(findRemovedPublicSlugs(previous, {version: 1, repos: [{owner: 1, name: 2}, null]})).toEqual(['acme--widget'])
  })

  it('ignores a malformed previous file (nothing known to be public)', () => {
    expect(findRemovedPublicSlugs(undefined, file())).toEqual([])
    expect(findRemovedPublicSlugs({version: 1, repos: 'nope'}, file())).toEqual([])
    expect(findRemovedPublicSlugs({version: 1, repos: [{owner: 'a'}, 3]}, file())).toEqual([])
  })

  it('ignores names that cannot form a wiki slug', () => {
    expect(findRemovedPublicSlugs(file(row({owner: '...', name: '___'})), file())).toEqual([])
  })

  it('returns slugs sorted for deterministic output', () => {
    const previous = file(row({name: 'zeta'}), row({name: 'alpha'}))

    expect(findRemovedPublicSlugs(previous, file())).toEqual(['acme--alpha', 'acme--zeta'])
  })

  it('compares slugs, so a case-only rename does not strand the page', () => {
    const previous = file(row({name: 'Widget', node_id: 'R_widget'}))
    const next = file(row({name: 'widget', node_id: 'R_widget'}))

    expect(findRemovedPublicSlugs(previous, next)).toEqual([])
  })
})

describe('evaluateRenameGuard', () => {
  const previous = file(row({name: 'old-widget', node_id: 'R_widget'}))
  const renamed = file(row({name: 'new-widget', node_id: 'R_widget'}))

  async function evaluate(states: Record<string, WikiPageState>, prev: unknown = previous, next: unknown = renamed) {
    const lookup = vi.fn(async (slug: string): Promise<WikiPageState> => states[slug] ?? 'unverifiable')
    const verdict = await evaluateRenameGuard({previous: prev, next, lookup})
    return {verdict, lookup}
  }

  it('allows without any lookup when no public name is removed', async () => {
    const {verdict, lookup} = await evaluate({}, renamed, renamed)

    expect(verdict).toEqual({kind: 'allow'})
    expect(lookup).not.toHaveBeenCalled()
  })

  it('allows a rename only when absence of the old page is verified', async () => {
    const {verdict, lookup} = await evaluate({'acme--old-widget': 'absent'})

    expect(verdict).toEqual({kind: 'allow'})
    expect(lookup).toHaveBeenCalledExactlyOnceWith('acme--old-widget')
  })

  it('blocks when the old page exists', async () => {
    const {verdict} = await evaluate({'acme--old-widget': 'present'})

    expect(verdict).toEqual({kind: 'page-present', count: 1})
  })

  it('blocks when page state is unverifiable', async () => {
    const {verdict} = await evaluate({'acme--old-widget': 'unverifiable'})

    expect(verdict).toEqual({kind: 'unverifiable', count: 1})
  })

  it('prefers the page-present verdict over unverifiable and counts each', async () => {
    const prev = file(
      row({name: 'one', node_id: 'R_1'}),
      row({name: 'two', node_id: 'R_2'}),
      row({name: 'three', node_id: 'R_3'}),
    )
    const {verdict} = await evaluate(
      {'acme--one': 'present', 'acme--two': 'unverifiable', 'acme--three': 'present'},
      prev,
      file(),
    )

    expect(verdict).toEqual({kind: 'page-present', count: 2})
  })

  it('counts every unverifiable name when none are present', async () => {
    const prev = file(row({name: 'one', node_id: 'R_1'}), row({name: 'two', node_id: 'R_2'}))
    const {verdict} = await evaluate({'acme--one': 'unverifiable', 'acme--two': 'absent'}, prev, file())

    expect(verdict).toEqual({kind: 'unverifiable', count: 1})
  })
})

function octokitWith(getContent: (params: unknown) => Promise<unknown>): OctokitClient {
  return {rest: {repos: {getContent}}} as unknown as OctokitClient
}

async function lookup(getContent: (params: unknown) => Promise<unknown>): Promise<WikiPageState> {
  return lookupRepoWikiPage({
    octokit: octokitWith(getContent),
    owner: 'fro-bot',
    repo: '.github',
    branch: 'data',
    slug: 'acme--old-widget',
  })
}

describe('lookupRepoWikiPage', () => {
  it('reads the exact repo page path on the target branch', async () => {
    const getContent = vi.fn(async (_params: unknown) => ({data: {type: 'file'}}))

    await lookup(getContent)

    expect(getContent).toHaveBeenCalledExactlyOnceWith({
      owner: 'fro-bot',
      repo: '.github',
      ref: 'data',
      path: 'knowledge/wiki/repos/acme--old-widget.md',
    })
  })

  it('reports present for a file, regardless of its content', async () => {
    expect(await lookup(async () => ({data: {type: 'file', content: ''}}))).toBe('present')
  })

  it('reports present for any non-404 success shape (directory, array) as ambiguous occupancy', async () => {
    expect(await lookup(async () => ({data: [{type: 'file'}]}))).toBe('present')
    expect(await lookup(async () => ({data: {type: 'dir'}}))).toBe('present')
  })

  it('reports absent only for a definite 404', async () => {
    expect(
      await lookup(async () => {
        throw apiError(404, 'Not Found')
      }),
    ).toBe('absent')
  })

  it.each([401, 403, 409, 429, 500, 502])('reports unverifiable for HTTP %i', async status => {
    expect(
      await lookup(async () => {
        throw apiError(status)
      }),
    ).toBe('unverifiable')
  })

  it('reports unverifiable for a network failure without an HTTP status', async () => {
    expect(
      await lookup(async () => {
        throw new TypeError('fetch failed')
      }),
    ).toBe('unverifiable')
  })

  it('does not coerce a string status into absence', async () => {
    expect(
      await lookup(async () => {
        throw Object.assign(new Error('Not Found'), {status: '404'})
      }),
    ).toBe('unverifiable')
  })
})
