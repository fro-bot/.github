/**
 * Behavior of the one branch-safety rule that `commit-metadata.ts`, `wiki-ingest.ts` and
 * `rename-tracked-repo.ts` share. Each consumer's own suite pins its error shape; this table pins the
 * rule itself, including the canonical `fro-bot/.github@data` exemption.
 */
import {assertBranchWritable, type BranchProtectionClient, type BranchRefusal} from '@fro-bot/wiki-write-core'
import {describe, expect, it, vi} from 'vitest'

interface Data {
  protected?: boolean
  protection?: {enabled?: boolean} | null
}

function clientReporting(data: Data): {client: BranchProtectionClient; getBranch: ReturnType<typeof vi.fn>} {
  const getBranch = vi.fn(async (_params: {owner: string; repo: string; branch: string}) => ({data}))
  return {client: {rest: {repos: {getBranch}}}, getBranch}
}

class Refused extends Error {
  readonly reason: BranchRefusal

  constructor(reason: BranchRefusal) {
    super(reason)
    this.reason = reason
  }
}

async function outcome(
  data: Data,
  target: {owner: string; repo: string; branch: string},
): Promise<BranchRefusal | 'allowed'> {
  const {client} = clientReporting(data)
  try {
    await assertBranchWritable(client, target.owner, target.repo, target.branch, reason => {
      throw new Refused(reason)
    })
    return 'allowed'
  } catch (error: unknown) {
    if (error instanceof Refused) return error.reason
    throw error
  }
}

const CANONICAL = {owner: 'fro-bot', repo: '.github', branch: 'data'}

describe('assertBranchWritable', () => {
  it.each<[string, Data, {owner: string; repo: string; branch: string}, BranchRefusal | 'allowed']>([
    ['an unprotected branch', {protected: false}, {owner: 'o', repo: 'r', branch: 'feature'}, 'allowed'],
    ['no protection reported at all', {}, {owner: 'o', repo: 'r', branch: 'feature'}, 'allowed'],
    ['a null protection object', {protected: false, protection: null}, CANONICAL, 'allowed'],
    ['a disabled protection object', {protection: {enabled: false}}, CANONICAL, 'allowed'],
    [
      'a branch protected by the top-level flag',
      {protected: true},
      {owner: 'o', repo: 'r', branch: 'feature'},
      'protected',
    ],
    [
      'a branch protected by the nested flag only',
      {protected: false, protection: {enabled: true}},
      {owner: 'o', repo: 'r', branch: 'feature'},
      'protected',
    ],
    ['the canonical data branch, protected by the top-level flag', {protected: true}, CANONICAL, 'allowed'],
    ['the canonical data branch, protected by the nested flag', {protection: {enabled: true}}, CANONICAL, 'allowed'],
    ["another repo's data branch, protected", {protected: true}, {...CANONICAL, repo: 'other'}, 'protected'],
    ["another owner's data branch, protected", {protected: true}, {...CANONICAL, owner: 'someone'}, 'protected'],
    [
      'a different branch of the canonical repo, protected',
      {protected: true},
      {...CANONICAL, branch: 'release'},
      'protected',
    ],
    [
      'a case-variant of the canonical target, protected',
      {protected: true},
      {...CANONICAL, owner: 'Fro-Bot'},
      'protected',
    ],
  ])('%s', async (_label, data, target, expected) => {
    expect(await outcome(data, target)).toBe(expected)
  })

  it('refuses main without asking GitHub, even for the canonical repo', async () => {
    const {client, getBranch} = clientReporting({protected: false})

    await expect(
      assertBranchWritable(client, 'fro-bot', '.github', 'main', reason => {
        throw new Refused(reason)
      }),
    ).rejects.toMatchObject({reason: 'main'})
    expect(getBranch).not.toHaveBeenCalled()
  })

  it('asks GitHub about exactly the target it was given', async () => {
    const {client, getBranch} = clientReporting({protected: false})

    await assertBranchWritable(client, 'o', 'r', 'b', () => {
      throw new Error('unexpected refusal')
    })

    expect(getBranch).toHaveBeenCalledExactlyOnceWith({owner: 'o', repo: 'r', branch: 'b'})
  })

  it('lets a lookup failure propagate rather than treating the branch as writable', async () => {
    const client: BranchProtectionClient = {
      rest: {
        repos: {
          getBranch: async () => {
            throw new Error('network down')
          },
        },
      },
    }

    await expect(
      assertBranchWritable(client, 'o', 'r', 'b', () => {
        throw new Error('unexpected refusal')
      }),
    ).rejects.toThrow('network down')
  })
})
