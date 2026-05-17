import type {CommitMetadataParams, CommitMetadataResult} from './commit-metadata.ts'
import type {OctokitClient, RepositoryInvitation} from './handle-invitation.ts'

import {describe, expect, it, vi} from 'vitest'
import {
  countPublicAcceptedInvitations,
  formatInvitationGithubOutput,
  handleInvitations,
  InvitationHandlingError,
} from './handle-invitation.ts'
import {assertReposFile} from './schemas.ts'

type CommitMetadataMock = (params: CommitMetadataParams) => Promise<CommitMetadataResult>

function mockOctokit(overrides?: {
  listInvitationsForAuthenticatedUser?: () => Promise<{
    data: RepositoryInvitation[]
  }>
  getRepo?: (params: {owner: string; repo: string}) => Promise<{data: {node_id?: unknown; private?: unknown}}>
  acceptInvitationForAuthenticatedUser?: (params: {invitation_id: number}) => Promise<void>
  starRepoForAuthenticatedUser?: (params: {owner: string; repo: string}) => Promise<void>
  createWorkflowDispatch?: (params: {
    owner: string
    repo: string
    workflow_id: string
    ref: string
    inputs?: Record<string, string>
  }) => Promise<void>
}): OctokitClient {
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
        get:
          overrides?.getRepo ??
          (async ({owner, repo}: {owner: string; repo: string}) => ({
            data: {node_id: `R_${owner}_${repo}`, private: false},
          })),
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
  } as unknown as OctokitClient
}

async function readTestMetadata(path: string): Promise<unknown> {
  if (path === 'metadata/allowlist.yaml') {
    return {
      version: 1,
      approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}],
    }
  }

  return {version: 1, repos: []}
}

describe('handleInvitations', () => {
  it('accepts approved invitations, stars repos, updates metadata, and dispatches survey', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const starRepoForAuthenticatedUser = vi.fn(async () => undefined)
    const createWorkflowDispatch = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({
      committed: true,
      sha: 'commit-sha',
      attempts: 1,
    }))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 101,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'hello-world',
              node_id: 'R_kgDOPUBLIC',
              private: false,
              owner: {login: 'fro-bot'},
            },
          },
        ],
      }),
      getRepo: async () => ({data: {node_id: 'R_kgDOPUBLIC', private: false}}),
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
      readMetadata: readTestMetadata,
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
      inputs: {node_id: 'R_kgDOPUBLIC'},
    })
    expect(commitMetadata).toHaveBeenCalledOnce()

    // #and the mutator persists discovery_channel: 'collab' so the entry surfaces
    // through the collab channel in reconcile reports
    const commitCall = commitMetadata.mock.calls[0]?.[0]
    expect(commitCall?.message).toBe('chore(metadata): add fro-bot/hello-world from invitation polling')
    const mutator = commitCall?.mutator
    expect(typeof mutator).toBe('function')
    if (typeof mutator === 'function') {
      const newReposFile = mutator({version: 1, repos: []})
      assertReposFile(newReposFile)
      expect(newReposFile.repos[0]?.discovery_channel).toBe('collab')
      expect(newReposFile.repos[0]?.next_survey_eligible_at).toBeNull()
      expect(newReposFile.repos[0]?.private).toBe(false)
      expect(newReposFile.repos[0]?.node_id).toBe('R_kgDOPUBLIC')
    }
  })

  it('fails closed when a public-looking invitation becomes private after acceptance', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const starRepoForAuthenticatedUser = vi.fn(async () => undefined)
    const createWorkflowDispatch = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 113,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'flipped-repo',
              node_id: 'R_kgDOFLIPPED',
              private: false,
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      getRepo: async () => ({data: {node_id: 'R_kgDOFLIPPED', private: true}}),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
      starRepoForAuthenticatedUser,
      createWorkflowDispatch,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 113,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: 'R_kgDOFLIPPED',
        status: 'accepted',
      },
    ])
    expect(acceptInvitation).toHaveBeenCalledWith({invitation_id: 113})
    expect(starRepoForAuthenticatedUser).toHaveBeenCalledWith({owner: 'private-owner', repo: 'flipped-repo'})
    expect(createWorkflowDispatch).not.toHaveBeenCalled()
    expect(commitMetadata).toHaveBeenCalledOnce()
    expect(commitMetadata.mock.calls[0]?.[0].message).toBe('chore(metadata): accept invitation R_kgDOFLIPPED')
    const mutator = commitMetadata.mock.calls[0]?.[0].mutator
    expect(typeof mutator).toBe('function')
    if (typeof mutator === 'function') {
      const newReposFile = mutator({version: 1, repos: []})
      assertReposFile(newReposFile)
      expect(newReposFile.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_kgDOFLIPPED',
        private: true,
        node_id: 'R_kgDOFLIPPED',
      })
      expect(JSON.stringify(newReposFile)).not.toContain('private-owner')
      expect(JSON.stringify(newReposFile)).not.toContain('flipped-repo')
    }
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('flipped-repo')
  })

  it('uses the refreshed node_id from repos.get when accepting a still-public invitation', async () => {
    // #given an invitation that carries node_id A, but repos.get returns node_id B
    // (e.g. the repo was deleted and recreated between invitation send and acceptance)
    // #then the dispatch and metadata use node_id B (authoritative post-acceptance value)
    const acceptInvitation = vi.fn(async () => undefined)
    const starRepoForAuthenticatedUser = vi.fn(async () => undefined)
    const createWorkflowDispatch = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 121,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'recreated-repo',
              node_id: 'R_kgDO_STALE_A',
              private: false,
              owner: {login: 'fro-bot'},
            },
          },
        ],
      }),
      getRepo: async () => ({data: {node_id: 'R_kgDO_FRESH_B', private: false}}),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
      starRepoForAuthenticatedUser,
      createWorkflowDispatch,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed[0]?.status).toBe('accepted')
    // Dispatch and metadata must use the FRESH node_id, not the stale one from the invitation
    expect(createWorkflowDispatch).toHaveBeenCalledWith(expect.objectContaining({inputs: {node_id: 'R_kgDO_FRESH_B'}}))
    const mutator = commitMetadata.mock.calls[0]?.[0].mutator
    if (typeof mutator === 'function') {
      const newReposFile = mutator({version: 1, repos: []})
      assertReposFile(newReposFile)
      expect(newReposFile.repos[0]).toMatchObject({node_id: 'R_kgDO_FRESH_B'})
    }
  })

  it('fails public invitations that are missing node_id before accepting them', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 112,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'public-repo',
              private: false,
              owner: {login: 'fro-bot'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 112,
        inviter: 'marcusrbrown',
        owner: 'fro-bot',
        repo: 'public-repo',
        status: 'failed',
        errorCode: 'API_ERROR',
        message: 'Invitation repository.node_id is required',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
  })

  it('accepts private invitations without writing canonical names to public surfaces', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const starRepoForAuthenticatedUser = vi.fn(async () => undefined)
    const createWorkflowDispatch = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({
      committed: true,
      sha: 'commit-sha',
      attempts: 1,
    }))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 107,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'secret-repo',
              node_id: 'R_kgDOPRIVATE',
              private: true,
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
      starRepoForAuthenticatedUser,
      createWorkflowDispatch,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 107,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: 'R_kgDOPRIVATE',
        status: 'accepted',
      },
    ])
    expect(acceptInvitation).toHaveBeenCalledWith({invitation_id: 107})
    expect(starRepoForAuthenticatedUser).toHaveBeenCalledWith({owner: 'private-owner', repo: 'secret-repo'})
    expect(createWorkflowDispatch).not.toHaveBeenCalled()
    expect(commitMetadata).toHaveBeenCalledOnce()

    const commitCall = commitMetadata.mock.calls[0]?.[0]
    expect(commitCall?.message).toBe('chore(metadata): accept invitation R_kgDOPRIVATE')
    const mutator = commitCall?.mutator
    expect(typeof mutator).toBe('function')
    if (typeof mutator === 'function') {
      const newReposFile = mutator({version: 1, repos: []})
      assertReposFile(newReposFile)
      expect(newReposFile.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_kgDOPRIVATE',
        private: true,
        node_id: 'R_kgDOPRIVATE',
        discovery_channel: 'collab',
      })
      expect(JSON.stringify(newReposFile)).not.toContain('private-owner')
      expect(JSON.stringify(newReposFile)).not.toContain('secret-repo')
    }
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('secret-repo')
  })

  it('redacts private invitation failure messages from downstream API calls', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const starRepoForAuthenticatedUser = vi.fn(async () => {
      throw new Error('failed to star private-owner/secret-repo')
    })
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 111,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'secret-repo',
              node_id: 'R_kgDOPRIVATE',
              private: true,
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
      starRepoForAuthenticatedUser,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 111,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: 'R_kgDOPRIVATE',
        status: 'failed',
        errorCode: 'API_ERROR',
        message: 'Private invitation handling failed for R_kgDOPRIVATE',
      },
    ])
    expect(commitMetadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('secret-repo')
  })

  it('fails private invitations that are missing node_id before accepting them', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 108,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'secret-repo',
              private: true,
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 108,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: '[REDACTED]',
        status: 'failed',
        errorCode: 'API_ERROR',
        message: 'Private invitation is missing repository.node_id',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('secret-repo')
  })

  it('fails invitations with malformed private fields before accepting them', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 109,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'secret-repo',
              node_id: 'R_kgDOPRIVATE',
              private: 'yes',
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 109,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: 'R_kgDOPRIVATE',
        status: 'failed',
        errorCode: 'API_ERROR',
        message: 'Invitation repository.private must be boolean when present',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('secret-repo')
  })

  it('redacts malformed visibility payloads without node_id', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 114,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'secret-repo',
              private: 'yes',
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 114,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: '[REDACTED]',
        status: 'failed',
        errorCode: 'API_ERROR',
        message: 'Invitation repository.private must be boolean when present',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('secret-repo')
  })

  it('fails invitations with missing private fields before accepting them', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 110,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'unknown-visibility',
              node_id: 'R_kgDOUNKNOWN',
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 110,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: 'R_kgDOUNKNOWN',
        status: 'failed',
        errorCode: 'API_ERROR',
        message: 'Invitation repository.private is required',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('unknown-visibility')
  })

  it('redacts missing visibility payloads without node_id', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn<CommitMetadataMock>(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 116,
            inviter: {login: 'marcusrbrown'},
            repository: {
              name: 'unknown-visibility',
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 116,
        inviter: 'marcusrbrown',
        owner: '[REDACTED]',
        repo: '[REDACTED]',
        status: 'failed',
        errorCode: 'API_ERROR',
        message: 'Invitation repository.private is required',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('unknown-visibility')
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
              node_id: 'R_kgDOUNKNOWNPUBLIC',
              private: false,
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
      readMetadata: readTestMetadata,
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

  it('redacts skipped private invitations from unapproved inviters', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 115,
            inviter: {login: 'random-user'},
            repository: {
              name: 'secret-repo',
              node_id: 'R_kgDOPRIVATE',
              private: true,
              owner: {login: 'private-owner'},
            },
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    const result = await handleInvitations({
      octokit,
      allowlistPath: 'metadata/allowlist.yaml',
      reposPath: 'metadata/repos.yaml',
      now: new Date('2026-04-16T12:00:00.000Z'),
      workflowFile: 'survey.yaml',
      workflowRef: 'main',
      commitMetadata,
      bootstrapDataBranch: vi.fn(async () => ({})),
      readMetadata: readTestMetadata,
    })

    expect(result.processed).toEqual([
      {
        invitationId: 115,
        inviter: 'random-user',
        owner: '[REDACTED]',
        repo: 'R_kgDOPRIVATE',
        status: 'skipped',
        reason: 'inviter-not-allowlisted',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-owner')
    expect(JSON.stringify(result)).not.toContain('secret-repo')
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
            repository: {name: 'broken-repo', node_id: 'R_kgDOBROKEN', private: false, owner: {login: 'fro-bot'}},
          },
          {
            id: 104,
            inviter: {login: 'marcusrbrown'},
            repository: {name: 'healthy-repo', node_id: 'R_kgDOHEALTHY', private: false, owner: {login: 'fro-bot'}},
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
      readMetadata: readTestMetadata,
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
            repository: {
              name: 'already-accepted',
              node_id: 'R_kgDOACCEPTED',
              private: false,
              owner: {login: 'fro-bot'},
            },
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
      readMetadata: readTestMetadata,
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
      readMetadata: readTestMetadata,
    }).catch((error: unknown) => error)

    // #then it surfaces a structured error with remediation
    expect(error).toBeInstanceOf(InvitationHandlingError)
    expect((error as InvitationHandlingError).code).toBe('RATE_LIMITED')
    expect((error as InvitationHandlingError).remediation).toContain('Retry after the GitHub API rate limit resets')
  })

  it('skips invitations where GitHub nulled the inviter', async () => {
    const acceptInvitation = vi.fn(async () => undefined)
    const commitMetadata = vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1}))
    const octokit = mockOctokit({
      listInvitationsForAuthenticatedUser: async () => ({
        data: [
          {
            id: 106,
            // GitHub returns inviter: null when the inviting user's account has been deleted.
            inviter: null as unknown as {login: string},
            repository: {name: 'orphaned-repo', node_id: 'R_kgDOORPHANED', private: false, owner: {login: 'fro-bot'}},
          },
        ],
      }),
      acceptInvitationForAuthenticatedUser: acceptInvitation,
    })

    // #given an invitation from a deleted inviter account (inviter: null)
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
      readMetadata: readTestMetadata,
    })

    // #then it skips the invitation with inviter-unknown instead of throwing
    expect(result.processed).toEqual([
      {
        invitationId: 106,
        inviter: null,
        owner: 'fro-bot',
        repo: 'orphaned-repo',
        status: 'skipped',
        reason: 'inviter-unknown',
      },
    ])
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(commitMetadata).not.toHaveBeenCalled()
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
      readMetadata: readTestMetadata,
    })

    // #then it becomes a no-op
    expect(result).toEqual({processed: []})
    expect(commitMetadata).not.toHaveBeenCalled()
  })
})

describe('countPublicAcceptedInvitations', () => {
  it('excludes private accepted invitations from public notification counts', () => {
    expect(
      countPublicAcceptedInvitations([
        {invitationId: 1, inviter: 'marcusrbrown', owner: 'fro-bot', repo: 'public-repo', status: 'accepted'},
        {invitationId: 2, inviter: 'marcusrbrown', owner: '[REDACTED]', repo: 'R_kgDOPRIVATE', status: 'accepted'},
        {
          invitationId: 3,
          inviter: 'marcusrbrown',
          owner: 'fro-bot',
          repo: 'skipped-repo',
          status: 'skipped',
          reason: 'inviter-not-allowlisted',
        },
      ]),
    ).toBe(1)
  })
})

describe('formatInvitationGithubOutput', () => {
  it('writes an explicit public invitation count output', () => {
    expect(
      formatInvitationGithubOutput([
        {invitationId: 1, inviter: 'marcusrbrown', owner: 'fro-bot', repo: 'public-repo', status: 'accepted'},
        {invitationId: 2, inviter: 'marcusrbrown', owner: '[REDACTED]', repo: 'R_kgDOPRIVATE', status: 'accepted'},
      ]),
    ).toBe('public_invitations_accepted=1\n')
  })
})
