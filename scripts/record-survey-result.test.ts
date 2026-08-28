import {describe, expect, it} from 'vitest'

import {
  buildRecordSurveyResultInput,
  formatRecordSurveyResultError,
  formatRecordSurveyResultNonFatalOutcome,
  formatSurveyResultTarget,
} from './record-survey-result.ts'
import {DuplicateRepoIdentityError, RepoEntryNotFoundError} from './repos-metadata.ts'

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
        'record-survey-result: duplicate repo identity match during metadata write-back (node_id=R_duplicate, database_id=1174807412); scheduled reconcile run owns the repair (non-fatal)\n',
      stdout: `${JSON.stringify({committed: false, outcome: 'duplicate-identity', target: 'R_duplicate', status: 'success'})}\n`,
    })
  })
})
