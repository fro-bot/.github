import {describe, expect, it} from 'vitest'

import {
  buildRecordSurveyResultInput,
  formatRecordSurveyResultError,
  formatRecordSurveyResultNonFatalOutcome,
  formatSurveyResultTarget,
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
