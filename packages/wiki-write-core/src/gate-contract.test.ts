import {GATE_SOURCE_TREE_HASH} from '@fro-bot/wiki-write-core'
import {describe, expect, it} from 'vitest'

describe('gate contract', () => {
  it('embeds a built source tree hash instead of its placeholder', () => {
    expect(GATE_SOURCE_TREE_HASH).toMatch(/^[0-9a-f]{64}$/u)
    expect(GATE_SOURCE_TREE_HASH).not.toBe('__SOURCE_TREE_HASH__')
  })
})
