import {describe, expect, it} from 'vitest'

import {GATE_CONTRACT_VERSION} from './gate-contract.ts'

describe('gate contract', () => {
  it('pins the current gate contract version', () => {
    expect(GATE_CONTRACT_VERSION).toBe(1)
  })
})
