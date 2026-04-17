import type {OctokitClient} from './handle-invitation.ts'
import {describe, expect, it, vi} from 'vitest'
import {handleInvitations, InvitationHandlingError} from './handle-invitation.ts'

function mockOctokit(overrides?: {
  listInvitationsForAuthenticatedUser?: () => Promise<{
    data: Invitation[]
  }>
  acceptInvitationForAuthenticatedUser?: (params: {invitation_id: number}) => Promise<void>
  starRepoForAuthenticatedUser?: (params: {owner: string; repo: string}) => Promise<void>
  createWorkflowDispatch?: (params: {
    owner: string
    repo: string
    workflow_id: string
    ref: string
    inputs?: Record<string, string>
  }) => Promise<void>
}): HandleInvitationsOctokit {
  return {
    rest: {
      repos: {
        getBranch: async () => ({
          data: {name: 'data', protected: false, protection: {enabled: false}, commit: {sha: 'data-sha'}},
        }),
        getContent: async () => ({
          data: {type: 'file' as const, sha: 'repos-sha', content: 'dmVyc2lvbjogMQpyZXBvczogW10K', encoding: 'base64'},
        }),
        createOrUpdateFileContents: async () => ({data: {commit: {sha: 'metadata-commit-sha'}}}),
        listInvitationsForAuthenticatedUser:
          overrides?.listInvitationsForAuthenticatedUser ??
          (async () => ({
            data: [],
          })),
        acceptInvitationForAuthenticatedUser:
          overrides?.acceptInvitationForAuthenticatedUser ??
          (async () => {
            return undefined
          }),
      },
      git: {
        createRef: async () => ({data: {ref: 'refs/heads/data'}}),
      },
      activity: {
        starRepoForAuthenticatedUser:
          overrides?.starRepoForAuthenticatedUser ??
          (async () => {
            return undefined
          }),
      },
      actions: {
        createWorkflowDispatch:
          overrides?.createWorkflowDispatch ??
          (async () => {
            return undefined
          }),
      },
    },
  }
}

interface Invitation {
  id: number
  inviter: {
    login: string
  }
  repository: {
    name: string
    owner: {
      login: string
    }
  }
}

type HandleInvitationsOctokit = OctokitClient

describe('handleInvitations', () => {
  it('accepts approved invitations, stars repos, updates metadata, and dispatches survey', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const starRepoForAuthenticatedUser = vi.fn(async () => undefined)
    const createWorkflowDispatch = vi.fn(async () => undefined)
    const commitMetadata = vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 101,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'hello-world',
              owner: {login: 'fro-bot'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
      starRepoForAuthenticatedUser,
      createWorkflowDispatch,
    })

    // #given an approved inviter and a pending invitation
    // #when invitation polling runs
    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: async (path: string) => {
        if (path === 'metadata/allowlist.yaml') {
          return {
            version: 1,
            approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}],
          }
        }

        return {version: 1, repos: []}
      },
    })

    // #then it accepts, stars, records metadata, and dispatches the survey
    expect(result.processed).toHaveLength(1)
    expect(result.processed[0]).toMatchObject({
      invitationId: 101,
      inviter: 'marcusrbrown',
      owner: 'fro-bot',
      repo: 'hello-world',
      status: 'accepted',
    })
    expect(acceptInvitation).toHaveBeenCalledWith({invitation_id: 101})
    expect(starRepoForAuthenticatedUser).toHaveBeenCalledWith({owner: 'fro-bot', repo: 'hello-world'})
    expect(createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      workflow_id: 'survey.yaml',
      ref: 'main',
      inputs: {owner: 'fro-bot', repo: 'hello-world'},
    })
    expect(commitMetadata).toHaveBeenCalledOnce()
  })

  it('skips invitations from unapproved inviters', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 102,
            inviter: {login: 'random-user'},
            repository: {
              name: 'unknown-repo',
              owner: {login: 'someone-else'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    // #given an unapproved inviter
    // #when invitation polling runs
    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: async (path: string) => {
        if (path === 'metadata/allowlist.yaml') {
          return {
            version: 1,
            approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}],
          }
        }

        return {version: 1, repos: []}
      },
    })

    // #then it skips the invitation and returns a skipped result
    expect(result.processed).toEqual([
      {
        invitationId: 102,
        inviter: 'random-user',
        owner: 'someone-else',
        repo: 'unknown-repo',
        status: 'skipped',
        reason: 'inviter-not-allowlisted',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
  })

  it('continues processing when one invitation fails', async () => {
    const acceptInvitation = vi
      .fn<(params: {invitation_id: number}) => Promise<void>>()
      .mockRejectedValueOnce(Object.assign(new Error('boom'), {status: 500}))
      .mockResolvedValueOnce(undefined)
    const starRepoForAuthenticatedUser = vi.fn(async () => undefined)
    const createWorkflowDispatch = vi.fn(async () => undefined)
    const commitMetadata = vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 103,
            inviter: {login: 'marcusrbrown'},
            repository: {name: 'broken-repo', owner: {login: 'fro-bot'}},
          },
          {
            id: 104,
            inviter: {login: 'marcusrbrown'},
            repository: {name: 'healthy-repo', owner: {login: 'fro-bot'}},
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
      starRepoForAuthenticatedUser,
      createWorkflowDispatch,
    })

    // #given multiple invitations and one invite fails during acceptance
    // #when invitation polling runs
    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      readMetadata: async (path: string) => {
        if (path === 'metadata/allowlist.yaml') {
          return {
            version: 1,
            approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}],
          }
        }

        return {version: 1, repos: []}
      },
    })

    // #then other invitations still complete successfully
    expect(result.processed).toHaveLength(2)
    expect(result.processed[0]).toMatchObject({
      invitationId: 103,
      status: 'failed',
      errorCode: 'API_ERROR',
    })
    expect(result.processed[1]).toMatchObject({
      invitationId: 104,
      status: 'accepted',
    })
    expect(starRepoForAuthenticatedUser).toHaveBeenCalledOnce()
    expect(commitMetadata).toHaveBeenCalledOnce()
  })

  it('treats revoked or already accepted invitations as success', async () => {
    const acceptInvitation = vi.fn(async () => {
      throw Object.assign(new Error('Gone'), {status: 410})
    })
    const starRepoForAuthenticatedUser = vi.fn(async () => undefined)
    const createWorkflowDispatch = vi.fn(async () => undefined)
    const commitMetadata = vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 105,
            inviter: {login: 'marcusrbrown'},
            repository: {name: 'already-accepted', owner: {login: 'fro-bot'}},
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
      starRepoForAuthenticatedUser,
      createWorkflowDispatch,
    })

    // #given an already-accepted or revoked invitation
    // #when invitation polling runs
    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      readMetadata: async (path: string) => {
        if (path === 'metadata/allowlist.yaml') {
          return {
            version: 1,
            approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}],
          }
        }

        return {version: 1, repos: []}
      },
    })

    // #then it treats the invite as successful instead of erroring
    expect(result.processed).toEqual([
      {
        invitationId: 105,
        inviter: 'marcusrbrown',
        owner: 'fro-bot',
        repo: 'already-accepted',
        status: 'accepted',
      },
    ])
    expect(starRepoForAuthenticatedUser).toHaveBeenCalledWith({owner: 'fro-bot', repo: 'already-accepted'})
    expect(commitMetadata).toHaveBeenCalledOnce()
  })

  it('throws a structured error when polling is rate limited', async () => {
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => {
        throw Object.assign(new Error('Too Many Requests'), {status: 429})
      },
    })

    // #given GitHub rate limits invitation polling
    // #when invitation polling runs
    const error = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata: vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1})),
      readMetadata: async (path: string) => {
        if (path === 'metadata/allowlist.yaml') {
          return {
            version: 1,
            approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}],
          }
        }

        return {version: 1, repos: []}
      },
    }).catch((error: unknown) => error)

    // #then it surfaces a structured error with remediation
    expect(error).toBeInstanceOf(InvitationHandlingError)
    expect((error as InvitationHandlingError).code).toBe('RATE_LIMITED')
    expect((error as InvitationHandlingError).remediation).toContain('Retry after the GitHub API rate limit resets')
  })

  it('returns an empty result when there are no invitations', async () => {
    const commitMetadata = vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({data: []}),
    })

    // #given no pending invitations
    // #when invitation polling runs
    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      readMetadata: async (path: string) => {
        if (path === 'metadata/allowlist.yaml') {
          return {
            version: 1,
            approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}],
          }
        }

        return {version: 1, repos: []}
      },
    })

    // #then it becomes a no-op
    expect(result).toEqual({processed: []})
    expect(commitMetadata).not.toHaveBeenCalled()
  })
})
