import type {RepoEntry, ReposFile} from '@fro.bot/wiki-write-core/schemas'

import type {commitMetadata} from './commit-metadata.ts'
import {describe, expect, it, vi} from 'vitest'
import YAML from 'yaml'
import {
  buildRecordSurveyResultInput,
  createSurveyWriteBack,
  formatRecordSurveyResultError,
  formatRecordSurveyResultNonFatalOutcome,
  formatSurveyResultTarget,
  formatSurveyWriteBackWarning,
  runRecordSurveyResult,
} from './record-survey-result.ts'
import {DuplicateRepoIdentityError, RepoEntryNotFoundError} from './repos-metadata.ts'

// Mirrors the Octokit `RequestError` shape observed on a 5xx Contents API write:
// an HTTP status with an empty `message`, which is what produced a blank log line.
function messagelessHttpError(status: number): Error {
  const error = new Error('replaced below to mirror an empty API error body')
  error.name = 'HttpError'
  error.message = ''
  return Object.assign(error, {status})
}

describe('buildRecordSurveyResultInput', () => {
  it('includes private/node_id when supplied by the workflow environment', () => {
    const input = buildRecordSurveyResultInput({
      REPO_OWNER: 'private-owner',
      REPO_NAME: 'secret-repo',
      REPO_PRIVATE: 'true',
      REPO_NODE_ID: 'R_kgDOPRIVATE',
      SURVEY_STATUS: 'success',
      SURVEY_AT: '2026-05-08T12:34:56Z',
    })

    expect(input).toMatchObject({
      owner: 'private-owner',
      repo: 'secret-repo',
      private: true,
      node_id: 'R_kgDOPRIVATE',
      status: 'success',
    })
    expect(input.at.toISOString()).toBe('2026-05-08T12:34:56.000Z')
  })

  it('requires REPO_NODE_ID when REPO_PRIVATE is true', () => {
    expect(() =>
      buildRecordSurveyResultInput({
        REPO_OWNER: 'private-owner',
        REPO_NAME: 'secret-repo',
        REPO_PRIVATE: 'true',
        SURVEY_STATUS: 'success',
      }),
    ).toThrow('REPO_NODE_ID is required when REPO_PRIVATE is true')
  })
})

describe('buildRecordSurveyResultInput (page conflict)', () => {
  const env = {
    REPO_OWNER: 'alice',
    REPO_NAME: 'project',
    REPO_PRIVATE: 'false',
    REPO_NODE_ID: 'R_kgDOPUBLIC',
    SURVEY_STATUS: 'failure',
    SURVEY_AT: '2026-10-21T09:30:00Z',
  }

  it('marks the input as a conflict when SURVEY_CONFLICT is true', () => {
    expect(buildRecordSurveyResultInput({...env, SURVEY_CONFLICT: 'true'})).toMatchObject({conflict: true})
  })

  it.each([undefined, '', 'false'])('leaves the conflict flag off when SURVEY_CONFLICT is %j', value => {
    expect(buildRecordSurveyResultInput({...env, SURVEY_CONFLICT: value})).not.toHaveProperty('conflict')
  })

  it('rejects a SURVEY_CONFLICT value that is not a boolean', () => {
    expect(() => buildRecordSurveyResultInput({...env, SURVEY_CONFLICT: 'yes'})).toThrow(
      "SURVEY_CONFLICT must be 'true' or 'false', got 'yes'",
    )
  })
})

describe('formatSurveyResultTarget', () => {
  it('uses node_id instead of owner/name for private targets', () => {
    const target = formatSurveyResultTarget({
      owner: 'private-owner',
      repo: 'secret-repo',
      private: true,
      node_id: 'R_kgDOPRIVATE',
    })

    expect(target).toBe('R_kgDOPRIVATE')
  })
})

describe('formatRecordSurveyResultError', () => {
  it('omits canonical owner/repo from private not-found errors', () => {
    const message = formatRecordSurveyResultError(new RepoEntryNotFoundError('private-owner', 'secret-repo'), {
      REPO_OWNER: 'private-owner',
      REPO_NAME: 'secret-repo',
      REPO_PRIVATE: 'true',
      REPO_NODE_ID: 'R_kgDOPRIVATE',
      SURVEY_STATUS: 'success',
    })

    expect(message).toContain('R_kgDOPRIVATE')
    expect(message).not.toContain('private-owner')
    expect(message).not.toContain('secret-repo')
  })

  it('describes an API error whose message is empty instead of emitting a blank line', () => {
    const message = formatRecordSurveyResultError(messagelessHttpError(500), {
      REPO_OWNER: 'public-owner',
      REPO_NAME: 'public-repo',
      SURVEY_STATUS: 'failure',
    })

    expect(message).toBe('HttpError with no message (HTTP 500)')
  })

  it('describes a message-less error with no HTTP status', () => {
    const message = formatRecordSurveyResultError(new Error('   '), {
      REPO_OWNER: 'public-owner',
      REPO_NAME: 'public-repo',
      SURVEY_STATUS: 'failure',
    })

    expect(message).toBe('Error with no message')
  })

  it('keeps private survey targets out of opaque-error descriptions', () => {
    const message = formatRecordSurveyResultError(messagelessHttpError(500), {
      REPO_OWNER: 'private-owner',
      REPO_NAME: 'secret-repo',
      REPO_PRIVATE: 'true',
      REPO_NODE_ID: 'R_kgDOPRIVATE',
      SURVEY_STATUS: 'failure',
    })

    expect(message).not.toContain('private-owner')
    expect(message).not.toContain('secret-repo')
  })

  it('preserves a non-empty error message verbatim', () => {
    const message = formatRecordSurveyResultError(new Error('metadata write rejected'), {
      REPO_OWNER: 'public-owner',
      REPO_NAME: 'public-repo',
      SURVEY_STATUS: 'success',
    })

    expect(message).toBe('metadata write rejected')
  })
})

describe('formatRecordSurveyResultNonFatalOutcome', () => {
  it('formats duplicate identity write-back as a non-fatal structured outcome', () => {
    const outcome = formatRecordSurveyResultNonFatalOutcome(
      new DuplicateRepoIdentityError({node_id: 'R_duplicate', database_id: 1174807412}),
      {
        REPO_OWNER: 'private-owner',
        REPO_NAME: 'secret-repo',
        REPO_PRIVATE: 'true',
        REPO_NODE_ID: 'R_duplicate',
        SURVEY_STATUS: 'success',
      },
    )

    expect(outcome).toEqual({
      exitCode: 0,
      stderr:
        'record-survey-result: duplicate repo identity match during metadata write-back (node_id=R_duplicate); scheduled reconcile run owns the repair (non-fatal)\n',
      stdout: `${JSON.stringify({committed: false, outcome: 'duplicate-identity', target: 'R_duplicate', status: 'success'})}\n`,
    })
  })
})

describe('survey write-back outcome', () => {
  const NODE_ID = 'R_kgDOJt6i0Q'

  function trackedRow(overrides: Partial<RepoEntry> = {}): ReposFile {
    return {
      version: 1,
      repos: [
        {
          owner: 'marcusrbrown',
          name: 'panthe.ai',
          added: '2026-04-17',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
          discovery_channel: 'collab',
          next_survey_eligible_at: null,
          node_id: NODE_ID,
          private: false,
          ...overrides,
        },
      ],
    }
  }

  function inputFor(repo: string) {
    return buildRecordSurveyResultInput({
      REPO_OWNER: 'marcusrbrown',
      REPO_NAME: repo,
      REPO_PRIVATE: 'false',
      REPO_NODE_ID: NODE_ID,
      SURVEY_STATUS: 'success',
      SURVEY_AT: '2026-10-09T12:00:00Z',
    })
  }

  it('records failure keyed by node ID and keeps the stored name when the survey target was renamed', () => {
    const writeBack = createSurveyWriteBack(inputFor('panthea'))

    const next = YAML.parse(YAML.stringify(writeBack.mutator(trackedRow()))) as ReposFile

    expect(writeBack.outcome()).toBe('name-mismatch')
    expect(next.repos[0]).toMatchObject({
      owner: 'marcusrbrown',
      name: 'panthe.ai',
      node_id: NODE_ID,
      last_survey_at: '2026-10-09',
      last_survey_status: 'failure',
    })
  })

  it('records the requested status when the target matches the row', () => {
    const writeBack = createSurveyWriteBack(inputFor('panthe.ai'))

    const next = YAML.parse(YAML.stringify(writeBack.mutator(trackedRow()))) as ReposFile

    expect(writeBack.outcome()).toBe('recorded')
    expect(next.repos[0]?.last_survey_status).toBe('success')
  })

  it('reports no outcome before the mutator has run, and the latest outcome after a retry', () => {
    const writeBack = createSurveyWriteBack(inputFor('panthea'))
    expect(writeBack.outcome()).toBeUndefined()

    writeBack.mutator(trackedRow())
    expect(writeBack.outcome()).toBe('name-mismatch')

    writeBack.mutator(trackedRow({name: 'panthea'}))
    expect(writeBack.outcome()).toBe('recorded')
  })

  it.each([undefined, ''])('rejects REPO_NODE_ID %j at the env boundary, before any write-back is built', nodeId => {
    expect(() =>
      buildRecordSurveyResultInput({
        REPO_OWNER: 'marcusrbrown',
        REPO_NAME: 'panthe.ai',
        REPO_NODE_ID: nodeId,
        SURVEY_STATUS: 'success',
      }),
    ).toThrow('REPO_NODE_ID is required')
  })

  it('keeps owner, name and node ID out of the mismatch warning', () => {
    const warning = formatSurveyWriteBackWarning('name-mismatch')

    expect(warning).toContain('pending rename or transfer')
    expect(warning).not.toContain('marcusrbrown')
    expect(warning).not.toContain('panthe')
    expect(warning).not.toContain(NODE_ID)
    expect(formatSurveyWriteBackWarning('recorded')).toBeUndefined()
  })

  it('reports the status the mutator actually wrote, and none when nothing was written', () => {
    const matching = createSurveyWriteBack(inputFor('panthe.ai'))
    const renamed = createSurveyWriteBack(inputFor('panthea'))
    const visibility = createSurveyWriteBack(inputFor('panthe.ai'))

    expect(matching.written()).toBeUndefined()

    matching.mutator(trackedRow())
    renamed.mutator(trackedRow())
    // The survey says public; the stored row is private. Nothing may be recorded.
    visibility.mutator(trackedRow({private: true}))

    expect(matching.written()).toBe('success')
    expect(renamed.written()).toBe('failure')
    expect(visibility.outcome()).toBe('visibility-mismatch')
    expect(visibility.written()).toBeUndefined()
  })

  it('does not report a stale status after a retry finds nothing to write', () => {
    const writeBack = createSurveyWriteBack(inputFor('panthe.ai'))

    writeBack.mutator(trackedRow())
    expect(writeBack.written()).toBe('success')

    writeBack.mutator(trackedRow({private: true}))
    expect(writeBack.written()).toBeUndefined()
  })
})

function sinks() {
  const out: string[] = []
  const err: string[] = []
  return {io: {stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text)}, out, err}
}

function row(overrides: Record<string, unknown> = {}): RepoEntry {
  return {
    owner: 'fro-bot',
    name: 'dashboard',
    added: '2026-06-15',
    onboarding_status: 'onboarded',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: true,
    has_renovate: false,
    discovery_channel: 'owned',
    next_survey_eligible_at: null,
    private: false,
    node_id: 'R_kgDOPUBLIC1',
    ...overrides,
  }
}

const SURVEY_ENV = {
  GITHUB_REPOSITORY: 'fro-bot/.github',
  REPO_OWNER: 'fro-bot',
  REPO_NAME: 'dashboard',
  REPO_NODE_ID: 'R_kgDOPUBLIC1',
  SURVEY_STATUS: 'success',
  SURVEY_AT: '2026-10-30T00:00:00Z',
}

/** A commit that runs the mutator against `file` the way `commitMetadata` does, then reports a write. */
function committing(file: unknown, result = {committed: true as const, sha: 'c'.repeat(40), attempts: 1}) {
  return vi.fn<typeof commitMetadata>(async params => {
    await params.mutator(file)
    return result
  })
}

describe('runRecordSurveyResult', () => {
  it('records the survey, prints the commit as one JSON line and returns 0', async () => {
    const commit = committing({version: 1, repos: [row()]})
    const {io, out, err} = sinks()

    expect(await runRecordSurveyResult(SURVEY_ENV, io, commit)).toBe(0)

    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      owner: 'fro-bot',
      repo: '.github',
      path: 'metadata/repos.yaml',
      message: 'chore(reconcile): record survey success for fro-bot/dashboard',
    })
    expect(out).toEqual([
      `{"committed":true,"sha":"${'c'.repeat(40)}","attempts":1,"target":"fro-bot/dashboard","status":"success"}\n`,
    ])
    expect(err).toEqual([])
  })

  it('prints a no-op commit without a sha', async () => {
    const commit = committing(
      {version: 1, repos: [row()]},
      {committed: false as never, sha: undefined as never, attempts: 1},
    )
    const {io, out} = sinks()
    expect(await runRecordSurveyResult(SURVEY_ENV, io, commit)).toBe(0)
    expect(out).toEqual(['{"committed":false,"attempts":1,"target":"fro-bot/dashboard","status":"success"}\n'])
  })

  it('warns and reports the outcome when the node ID matches a row stored under another name', async () => {
    const commit = committing({version: 1, repos: [row({name: 'stored-name'})]})
    const {io, out, err} = sinks()
    expect(await runRecordSurveyResult(SURVEY_ENV, io, commit)).toBe(0)
    expect(err).toEqual([
      'record-survey-result: survey target does not match the tracked row for its node ID (pending rename or transfer); recorded failure and kept the stored name\n',
    ])
    expect(out[0]).toContain('"outcome":"name-mismatch"')
    expect(out[0]).toContain('"status":"failure"')
  })

  it('skips with exit 0 and a stderr line when the survey target has no entry', async () => {
    const commit = committing({version: 1, repos: [row({node_id: 'R_kgDOOTHER00', name: 'other'})]})
    const {io, out, err} = sinks()
    expect(await runRecordSurveyResult(SURVEY_ENV, io, commit)).toBe(0)
    expect(out).toEqual([])
    expect(err).toEqual([
      'record-survey-result: metadata/repos.yaml has no entry for fro-bot/dashboard; skipping (non-fatal)\n',
    ])
  })

  it('treats a duplicate identity as exit 0 with the non-fatal output', async () => {
    const commit = committing({version: 1, repos: [row(), row({name: 'twin'})]})
    const {io, out, err} = sinks()
    expect(await runRecordSurveyResult(SURVEY_ENV, io, commit)).toBe(0)
    expect(out).toEqual([
      '{"committed":false,"outcome":"duplicate-identity","target":"fro-bot/dashboard","status":"success"}\n',
    ])
    expect(err[0]).toMatch(/^record-survey-result: .*; scheduled reconcile run owns the repair \(non-fatal\)\n$/u)
  })

  it.each([
    [{...SURVEY_ENV, REPO_NODE_ID: undefined}, 'record-survey-result: REPO_NODE_ID is required\n'],
    [
      {...SURVEY_ENV, SURVEY_STATUS: 'maybe'},
      "record-survey-result: SURVEY_STATUS must be 'success' or 'failure', got 'maybe'\n",
    ],
    [{...SURVEY_ENV, SURVEY_AT: 'nope'}, "record-survey-result: SURVEY_AT is not a parseable date: 'nope'\n"],
    [{...SURVEY_ENV, GITHUB_REPOSITORY: undefined}, 'record-survey-result: GITHUB_REPOSITORY is required\n'],
    [
      {...SURVEY_ENV, GITHUB_REPOSITORY: 'nope'},
      "record-survey-result: GITHUB_REPOSITORY must be 'owner/name', got 'nope'\n",
    ],
  ])('returns 1 with the message on stderr for %j', async (env, line) => {
    const commit = vi.fn<typeof commitMetadata>()
    const {io, out, err} = sinks()
    expect(await runRecordSurveyResult(env, io, commit)).toBe(1)
    expect(commit).not.toHaveBeenCalled()
    expect(out).toEqual([])
    expect(err).toEqual([line])
  })

  it('returns 1 and describes a messageless API error by name and status', async () => {
    const commit = vi.fn<typeof commitMetadata>().mockRejectedValue(messagelessHttpError(502))
    const {io, err} = sinks()
    expect(await runRecordSurveyResult(SURVEY_ENV, io, commit)).toBe(1)
    expect(err).toEqual(['record-survey-result: HttpError with no message (HTTP 502)\n'])
  })
})
