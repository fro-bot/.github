import type {commitMetadata} from './commit-metadata.ts'

import {describe, expect, it, vi} from 'vitest'
import {formatResetSurveyTarget, parseTargets, runResetSurveyStatus} from './reset-survey-status.ts'

describe('parseTargets', () => {
  it('parses canonical owner/name targets', () => {
    expect(parseTargets('alice/project')).toEqual([{owner: 'alice', name: 'project'}])
  })

  it('parses node_id targets without requiring canonical owner/name', () => {
    expect(parseTargets('node_id:R_kgDOPRIVATE')).toEqual([
      {owner: '[REDACTED]', name: 'R_kgDOPRIVATE', private: true, node_id: 'R_kgDOPRIVATE'},
    ])
  })
})

describe('formatResetSurveyTarget', () => {
  it('uses node_id instead of owner/name for private targets', () => {
    expect(
      formatResetSurveyTarget({
        owner: '[REDACTED]',
        name: 'R_kgDOPRIVATE',
        private: true,
        node_id: 'R_kgDOPRIVATE',
      }),
    ).toBe('R_kgDOPRIVATE')
  })
})

function sinks() {
  const out: string[] = []
  const err: string[] = []
  return {io: {stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text)}, out, err}
}

describe('runResetSurveyStatus', () => {
  const env = {TARGETS: 'fro-bot/dashboard, node_id:R_kgDOPRIVATE', GITHUB_REPOSITORY: 'fro-bot/.github'}

  it('commits once per target and prints the results as JSON indented by two spaces', async () => {
    const commit = vi
      .fn<typeof commitMetadata>()
      .mockResolvedValueOnce({committed: true, sha: 'a'.repeat(40), attempts: 1})
      .mockResolvedValueOnce({committed: false, attempts: 2})
    const {io, out} = sinks()

    await runResetSurveyStatus(env, io, commit)

    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      owner: 'fro-bot',
      repo: '.github',
      path: 'metadata/repos.yaml',
      message: 'chore(recovery): reset survey status for fro-bot/dashboard',
    })
    expect(commit.mock.calls[1]?.[0].message).toBe('chore(recovery): reset survey status for R_kgDOPRIVATE')
    expect(out).toEqual([
      `${JSON.stringify(
        {
          targets: 2,
          results: [
            {target: 'fro-bot/dashboard', committed: true, attempts: 1, sha: 'a'.repeat(40)},
            {target: 'R_kgDOPRIVATE', committed: false, attempts: 2},
          ],
        },
        null,
        2,
      )}\n`,
    ])
  })

  it.each([
    [{...env, TARGETS: undefined}, 'TARGETS is required'],
    [{...env, TARGETS: ''}, 'TARGETS is required'],
    [{...env, GITHUB_REPOSITORY: undefined}, 'GITHUB_REPOSITORY is required'],
    [{...env, GITHUB_REPOSITORY: 'nope'}, "GITHUB_REPOSITORY must be 'owner/name', got 'nope'"],
    [{...env, TARGETS: ' , '}, 'TARGETS must contain at least one `owner/name` entry'],
  ])('throws before any commit for %j', async (badEnv, message) => {
    const commit = vi.fn<typeof commitMetadata>()
    const {io, out} = sinks()
    await expect(runResetSurveyStatus(badEnv, io, commit)).rejects.toThrow(message)
    expect(commit).not.toHaveBeenCalled()
    expect(out).toEqual([])
  })

  it('stops at the first failing target and prints nothing', async () => {
    const commit = vi
      .fn<typeof commitMetadata>()
      .mockResolvedValueOnce({committed: true, sha: 'a'.repeat(40), attempts: 1})
      .mockRejectedValueOnce(new Error('boom'))
    const {io, out} = sinks()
    await expect(runResetSurveyStatus(env, io, commit)).rejects.toThrow('boom')
    expect(commit).toHaveBeenCalledTimes(2)
    expect(out).toEqual([])
  })
})
