import {describe, expect, it} from 'vitest'
import YAML from 'yaml'

import {runCheck} from './check-repo-onboarded.ts'

// Minimal valid repos.yaml with a single public entry
function makeReposYaml(repos: unknown[]): string {
  return YAML.stringify({version: 1, repos})
}

function makePublicEntry(owner: string, name: string) {
  return {
    owner,
    name,
    added: '2026-01-01',
    onboarding_status: 'onboarded',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: false,
    has_renovate: false,
    discovery_channel: 'collab',
    next_survey_eligible_at: null,
    private: false,
  }
}

function makePrivateEntry(nodeId: string) {
  return {
    owner: '[REDACTED]',
    name: nodeId,
    added: '2026-01-01',
    onboarding_status: 'onboarded',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: false,
    has_renovate: false,
    discovery_channel: 'collab',
    next_survey_eligible_at: null,
    private: true,
    node_id: nodeId,
  }
}

function makeEntryNoPrivate(owner: string, name: string) {
  return {
    owner,
    name,
    added: '2026-01-01',
    onboarding_status: 'onboarded',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: false,
    has_renovate: false,
    discovery_channel: 'collab',
    next_survey_eligible_at: null,
    // private intentionally absent — simulates a legacy entry
  }
}

type ReadFileImpl = typeof import('node:fs/promises').readFile

function stubReadFile(content: string): ReadFileImpl {
  return (async () => content) as unknown as ReadFileImpl
}

function stubReadFileThrow(code: string): ReadFileImpl {
  return (async () => {
    const err = Object.assign(new Error(`stub error: ${code}`), {code})
    throw err
  }) as unknown as ReadFileImpl
}

describe('runCheck', () => {
  // Fail-closed: missing REPO_OWNER → false
  it('returns onboarded:false when REPO_OWNER is missing', async () => {
    const result = await runCheck({REPO_NAME: 'myrepo'})
    expect(result.onboarded).toBe(false)
    expect(result.reason).toBeDefined()
  })

  // Fail-closed: missing REPO_NAME → false
  it('returns onboarded:false when REPO_NAME is missing', async () => {
    const result = await runCheck({REPO_OWNER: 'alice'})
    expect(result.onboarded).toBe(false)
    expect(result.reason).toBeDefined()
  })

  // Fail-closed: empty REPO_OWNER → false
  it('returns onboarded:false when REPO_OWNER is empty string', async () => {
    const result = await runCheck({REPO_OWNER: '', REPO_NAME: 'myrepo'})
    expect(result.onboarded).toBe(false)
    expect(result.reason).toBeDefined()
  })

  // Fail-closed: empty REPO_NAME → false
  it('returns onboarded:false when REPO_NAME is empty string', async () => {
    const result = await runCheck({REPO_OWNER: 'alice', REPO_NAME: ''})
    expect(result.onboarded).toBe(false)
    expect(result.reason).toBeDefined()
  })

  // Fail-closed: ENOENT → false
  it('returns onboarded:false when readFileImpl throws ENOENT', async () => {
    const result = await runCheck(
      {REPO_OWNER: 'alice', REPO_NAME: 'project'},
      {readFileImpl: stubReadFileThrow('ENOENT')},
    )
    expect(result.onboarded).toBe(false)
    expect(result.reason).toMatch(/not found/)
  })

  // Fail-closed: other read error → false
  it('returns onboarded:false when readFileImpl throws a non-ENOENT error', async () => {
    const result = await runCheck(
      {REPO_OWNER: 'alice', REPO_NAME: 'project'},
      {readFileImpl: stubReadFileThrow('EACCES')},
    )
    expect(result.onboarded).toBe(false)
    expect(result.reason).toMatch(/failed to read/)
  })

  // Fail-closed: malformed YAML → false
  it('returns onboarded:false when repos.yaml is malformed YAML', async () => {
    const result = await runCheck(
      {REPO_OWNER: 'alice', REPO_NAME: 'project'},
      {readFileImpl: stubReadFile(': : invalid: yaml: [[[')},
    )
    expect(result.onboarded).toBe(false)
    expect(result.reason).toMatch(/malformed YAML/)
  })

  // Fail-closed: schema-invalid repos file → false
  it('returns onboarded:false when repos.yaml fails schema validation', async () => {
    // version:2 is invalid per assertReposFile
    const result = await runCheck(
      {REPO_OWNER: 'alice', REPO_NAME: 'project'},
      {readFileImpl: stubReadFile(YAML.stringify({version: 2, repos: []}))},
    )
    expect(result.onboarded).toBe(false)
    expect(result.reason).toMatch(/schema validation/)
  })

  // Fail-closed: empty-string repos.yaml → false (YAML.parse('') is undefined → schema rejects)
  it('returns onboarded:false when repos.yaml is an empty string', async () => {
    const result = await runCheck({REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFile('')})
    expect(result.onboarded).toBe(false)
    expect(result.reason).toMatch(/schema validation/)
  })

  // Privacy gate: entry present with private:false → true (the ONLY path to true)
  it('returns onboarded:true when entry exists with private:false', async () => {
    const yaml = makeReposYaml([makePublicEntry('alice', 'project')])
    const result = await runCheck({REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFile(yaml)})
    expect(result.onboarded).toBe(true)
    expect(result.target).toBe('alice/project')
    expect(result.reason).toBeUndefined()
  })

  // Privacy gate: entry present but private absent → false (fail-safe default)
  it('returns onboarded:false when entry exists but private is absent', async () => {
    const yaml = makeReposYaml([makeEntryNoPrivate('alice', 'project')])
    const result = await runCheck({REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFile(yaml)})
    expect(result.onboarded).toBe(false)
    expect(result.reason).toBeDefined()
  })

  // Privacy gate: entry present with private:true → false
  it('returns onboarded:false when entry exists with private:true', async () => {
    const yaml = makeReposYaml([makePrivateEntry('R_kgDOPRIVATE')])
    const result = await runCheck(
      {REPO_OWNER: '[REDACTED]', REPO_NAME: 'R_kgDOPRIVATE'},
      {readFileImpl: stubReadFile(yaml)},
    )
    expect(result.onboarded).toBe(false)
    expect(result.reason).toBeDefined()
  })

  // Fail-closed: absent entry → false
  it('returns onboarded:false when no entry exists for the given owner/repo', async () => {
    const yaml = makeReposYaml([makePublicEntry('alice', 'other-project')])
    const result = await runCheck({REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFile(yaml)})
    expect(result.onboarded).toBe(false)
    expect(result.reason).toBeDefined()
  })

  // Target field: always present in result for self-debuggable logs
  it('includes target in the result for all paths', async () => {
    // Missing env
    const r1 = await runCheck({})
    expect(r1.target).toBeDefined()

    // ENOENT
    const r2 = await runCheck({REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFileThrow('ENOENT')})
    expect(r2.target).toBe('alice/project')

    // Success
    const yaml = makeReposYaml([makePublicEntry('alice', 'project')])
    const r3 = await runCheck({REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFile(yaml)})
    expect(r3.target).toBe('alice/project')
  })

  // Invariant: no path other than genuine private===false match returns true
  it('never returns onboarded:true except for a genuine private===false match', async () => {
    const errorPaths: [string, Record<string, string | undefined>, {readFileImpl?: ReadFileImpl}?][] = [
      ['missing env', {}],
      ['empty owner', {REPO_OWNER: '', REPO_NAME: 'project'}],
      ['empty repo', {REPO_OWNER: 'alice', REPO_NAME: ''}],
      ['ENOENT', {REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFileThrow('ENOENT')}],
      ['malformed yaml', {REPO_OWNER: 'alice', REPO_NAME: 'project'}, {readFileImpl: stubReadFile('!!invalid')}],
      [
        'schema invalid',
        {REPO_OWNER: 'alice', REPO_NAME: 'project'},
        {readFileImpl: stubReadFile(YAML.stringify({version: 2, repos: []}))},
      ],
      [
        'private absent',
        {REPO_OWNER: 'alice', REPO_NAME: 'project'},
        {readFileImpl: stubReadFile(makeReposYaml([makeEntryNoPrivate('alice', 'project')]))},
      ],
      [
        'private true',
        {REPO_OWNER: '[REDACTED]', REPO_NAME: 'R_kgDOPRIVATE'},
        {readFileImpl: stubReadFile(makeReposYaml([makePrivateEntry('R_kgDOPRIVATE')]))},
      ],
      [
        'absent entry',
        {REPO_OWNER: 'alice', REPO_NAME: 'project'},
        {readFileImpl: stubReadFile(makeReposYaml([makePublicEntry('bob', 'other')]))},
      ],
    ]

    for (const [label, env, deps] of errorPaths) {
      const result = await runCheck(env, deps)
      expect(result.onboarded, `expected onboarded:false for path: ${label}`).toBe(false)
    }
  })
})
