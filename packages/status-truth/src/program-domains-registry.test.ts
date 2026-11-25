import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {assertReposFile} from '@fro.bot/wiki-write-core/schemas'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
// Not in stryker.config.json's testFiles on purpose: this test reads metadata/repos.yaml, and listing it there
// would make a registry change (every data promotion) run the mutation gate. checkDomainReposInRegistry is
// mutation-tested with in-memory rows in program-domains.test.ts; this file only checks the committed data.
import {checkDomainReposInRegistry, loadProgramDomains, selectDomain, type RegistryRepo} from './program-domains.ts'

const root = resolve(import.meta.dirname, '../../..')

function readRegistry(): RegistryRepo[] {
  const parsed: unknown = parse(readFileSync(resolve(root, 'metadata/repos.yaml'), 'utf8'))
  assertReposFile(parsed, 'repos')
  return parsed.repos.map(repo => ({
    nameWithOwner: `${repo.owner}/${repo.name}`,
    nodeId: repo.node_id ?? '',
    // An entry with no `private` value is treated as private until a probe sets it, as the registry's schema says.
    private: repo.private !== false,
    archived: repo.onboarding_status === 'archived',
  }))
}

describe('the committed program-domains.json against metadata/repos.yaml', () => {
  const committed = loadProgramDomains(resolve(root, 'program-domains.json'))

  it('lists only public, unarchived repositories the registry tracks, with the registry node IDs', () => {
    expect(() => checkDomainReposInRegistry(committed, readRegistry())).not.toThrow()
  })

  it('finds every harness-tools repository in the registry', () => {
    const names = new Set(readRegistry().map(repo => repo.nameWithOwner))

    for (const repo of selectDomain(committed, 'harness-tools').repos) {
      expect(names.has(repo.nameWithOwner)).toBe(true)
    }
  })
})
