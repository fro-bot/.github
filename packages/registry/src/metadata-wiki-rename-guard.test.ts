import type {OctokitClient} from './commit-metadata.ts'

import {describe, expect, it, vi} from 'vitest'

import {
  findBlockedPublicAssociations,
  findRemovedPublicAssociations,
  lookupRepoWikiPage,
  publicAssociationKey,
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

function removed(previous: unknown, next: unknown): string[] {
  return findRemovedPublicAssociations(previous, next).map(entry => entry.association)
}

describe('publicAssociationKey', () => {
  it('normalizes owner/name case-insensitively', () => {
    expect(publicAssociationKey('Acme', 'Widget')).toBe('acme/widget')
  })
})

describe('findRemovedPublicAssociations', () => {
  it('reports nothing when the public association set is unchanged', () => {
    const state = file(row({node_id: 'R_widget'}))

    expect(removed(state, structuredClone(state))).toEqual([])
  })

  it('reports the old association of a single-row rename, with its page slug', () => {
    const previous = file(row({name: 'old-widget', node_id: 'R_widget'}))
    const next = file(row({name: 'new-widget', node_id: 'R_widget'}))

    expect(findRemovedPublicAssociations(previous, next)).toEqual([
      {association: 'acme/old-widget', slug: 'acme--old-widget'},
    ])
  })

  it('reports the dropped association of a duplicate-row merge', () => {
    const previous = file(
      row({name: 'new-widget', node_id: 'R_widget'}),
      row({name: 'old-widget', node_id: 'R_widget'}),
    )
    const next = file(row({name: 'new-widget', node_id: 'R_widget'}))

    expect(removed(previous, next)).toEqual(['acme/old-widget'])
  })

  it('reports an ID-less old row that disappears (no identity to prove a downgrade)', () => {
    expect(removed(file(row({name: 'old-widget'})), file(row({name: 'new-widget', node_id: 'R_widget'})))).toEqual([
      'acme/old-widget',
    ])
  })

  it('reports a rename whose successor carries a different stable identity', () => {
    const previous = file(row({name: 'old-widget', node_id: 'R_old'}))
    const next = file(row({name: 'new-widget', node_id: 'R_other'}))

    expect(removed(previous, next)).toEqual(['acme/old-widget'])
  })

  it('matches successors by database_id alone', () => {
    const previous = file(row({name: 'old-widget', database_id: 42}))
    const downgraded = file(row({owner: '[REDACTED]', name: 'R_x', private: true, node_id: 'R_x', database_id: 42}))

    expect(removed(previous, file(row({name: 'new-widget', database_id: 42})))).toEqual(['acme/old-widget'])
    expect(removed(previous, downgraded)).toEqual([])
  })

  it('reports a public row that vanishes entirely', () => {
    expect(removed(file(row({node_id: 'R_widget'})), file())).toEqual(['acme/widget'])
  })

  it('does not report a visibility downgrade to private (redacted form)', () => {
    const previous = file(row({node_id: 'R_widget'}))
    const next = file(row({owner: '[REDACTED]', name: 'R_widget', private: true, node_id: 'R_widget'}))

    expect(removed(previous, next)).toEqual([])
  })

  it('does not report a downgrade to unknown visibility', () => {
    expect(removed(file(row({node_id: 'R_widget'})), file(row({node_id: 'R_widget', private: undefined})))).toEqual([])
  })

  it('does not report an ID-less downgrade that keeps the same association', () => {
    expect(removed(file(row()), file(row({private: true})))).toEqual([])
  })

  it('matches a legacy redacted successor by the node ID stored in name', () => {
    const previous = file(row({node_id: 'R_widget'}))
    const next = file({...row({private: true}), owner: '[REDACTED]', name: 'R_widget', node_id: undefined})

    expect(removed(previous, next)).toEqual([])
  })

  it('reports an ID-less downgrade into a redacted row (no lineage), leaving the decision to the caller', () => {
    const previous = file(row({name: 'old-widget'}))
    const next = file(row({owner: '[REDACTED]', name: 'R_x', private: true, node_id: 'R_x'}))

    expect(removed(previous, next)).toEqual(['acme/old-widget'])
  })

  it('still reports a rename that shares a redacted sibling of the same identity', () => {
    const previous = file(row({name: 'old-widget', node_id: 'R_widget'}))
    const next = file(
      row({name: 'new-widget', node_id: 'R_widget'}),
      row({owner: '[REDACTED]', name: 'R_widget', private: true, node_id: 'R_widget'}),
    )

    expect(removed(previous, next)).toEqual(['acme/old-widget'])
  })

  it('does not report names that were never public', () => {
    const previous = file(row({name: 'quiet', private: undefined}), row({name: 'hidden', private: true}))

    expect(removed(previous, file())).toEqual([])
  })

  it('treats a non-boolean private flag as not public', () => {
    expect(removed(file(row({private: 'false'})), file())).toEqual([])
  })

  it('fails closed on a malformed proposed file by reporting every public association as removed', () => {
    const previous = file(row({node_id: 'R_widget'}))

    expect(removed(previous, 'not a repos file')).toEqual(['acme/widget'])
    expect(removed(previous, {version: 1, repos: [{owner: 1, name: 2}, null]})).toEqual(['acme/widget'])
  })

  it('ignores a malformed previous file (nothing known to be public)', () => {
    expect(removed(undefined, file())).toEqual([])
    expect(removed({version: 1, repos: 'nope'}, file())).toEqual([])
    expect(removed({version: 1, repos: [{owner: 'a'}, 3]}, file())).toEqual([])
  })

  it('ignores associations that cannot form a wiki slug', () => {
    expect(removed(file(row({owner: '...', name: '___'})), file())).toEqual([])
  })

  it('returns associations sorted for deterministic output', () => {
    expect(removed(file(row({name: 'zeta'}), row({name: 'alpha'})), file())).toEqual(['acme/alpha', 'acme/zeta'])
  })

  it('does not treat a case-only rename as a removal', () => {
    const previous = file(row({name: 'Widget', node_id: 'R_widget'}))
    const next = file(row({name: 'widget', node_id: 'R_widget'}))

    expect(removed(previous, next)).toEqual([])
  })

  it('reports a rename between names that share a slug (`alpha.beta` → `alpha-beta`)', () => {
    const previous = file(row({name: 'alpha.beta', node_id: 'R_a'}))
    const next = file(row({name: 'alpha-beta', node_id: 'R_a'}))

    expect(findRemovedPublicAssociations(previous, next)).toEqual([
      {association: 'acme/alpha.beta', slug: 'acme--alpha-beta'},
    ])
  })

  it('does not let a slug-sharing repo stand in for a removed association', () => {
    // `alpha-beta` is still public and shares `alpha.beta`'s slug, but it is a different repo.
    const previous = file(row({name: 'alpha.beta', node_id: 'R_a'}), row({name: 'alpha-beta', node_id: 'R_b'}))
    const next = file(row({name: 'gamma', node_id: 'R_a'}), row({name: 'alpha-beta', node_id: 'R_b'}))

    expect(removed(previous, next)).toEqual(['acme/alpha.beta'])
  })

  it('decides slug-sharing repos independently: a downgrade is not a removal even beside a rename', () => {
    const previous = file(row({name: 'alpha.beta', node_id: 'R_a'}), row({name: 'alpha-beta', node_id: 'R_b'}))
    const next = file(
      row({name: 'gamma', node_id: 'R_a'}),
      row({owner: '[REDACTED]', name: 'R_b', private: true, node_id: 'R_b'}),
    )

    expect(removed(previous, next)).toEqual(['acme/alpha.beta'])
  })
})

describe('findBlockedPublicAssociations', () => {
  const states = (table: Record<string, WikiPageState>) => async (slug: string) => table[slug] ?? 'absent'

  it('splits removed associations by page state and ignores verified-absent ones', async () => {
    const previous = file(
      row({name: 'a', node_id: 'R_a'}),
      row({name: 'b', node_id: 'R_b'}),
      row({name: 'c', node_id: 'R_c'}),
    )

    const blocked = await findBlockedPublicAssociations({
      previous,
      next: file(),
      lookup: states({'acme--a': 'present', 'acme--b': 'unverifiable', 'acme--c': 'absent'}),
    })

    expect(blocked).toEqual({present: ['acme/a'], unverifiable: ['acme/b']})
  })

  it('looks up a shared slug once but decides each association', async () => {
    const previous = file(row({name: 'alpha.beta', node_id: 'R_a'}), row({name: 'alpha-beta', node_id: 'R_b'}))
    const lookup = vi.fn(states({'acme--alpha-beta': 'present'}))

    const blocked = await findBlockedPublicAssociations({previous, next: file(), lookup})

    expect(lookup).toHaveBeenCalledExactlyOnceWith('acme--alpha-beta')
    expect(blocked.present).toEqual(['acme/alpha-beta', 'acme/alpha.beta'])
  })

  it('does not look anything up when nothing is removed', async () => {
    const lookup = vi.fn(states({}))
    const state = file(row({node_id: 'R_widget'}))

    expect(await findBlockedPublicAssociations({previous: state, next: state, lookup})).toEqual({
      present: [],
      unverifiable: [],
    })
    expect(lookup).not.toHaveBeenCalled()
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
