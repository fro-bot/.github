import {describe, expect, it} from 'vitest'

import {formatResetSurveyTarget, parseTargets} from './reset-survey-status.ts'

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
