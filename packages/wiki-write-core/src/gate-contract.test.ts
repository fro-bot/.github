import {GATE_CONTRACT_VERSION, GATE_SOURCE_TREE_HASH} from '@fro.bot/wiki-write-core'
import {describe, expect, it} from 'vitest'

describe('gate contract', () => {
  it('keeps the placeholder in source; the package build embeds the hash into the published dist', () => {
    // In the repository `@fro.bot/wiki-write-core` resolves to source, so the constant is the
    // placeholder the build replaces. scripts/wiki-write-core-package.test.ts proves the published
    // tarball exports a 64-character hash equal to the committed gate-contract marker's.
    expect(GATE_SOURCE_TREE_HASH).toBe('__SOURCE_TREE_HASH__')
    expect(GATE_CONTRACT_VERSION).toBe(1)
  })
})
