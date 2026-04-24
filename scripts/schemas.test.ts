import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

import {
  assertAllowlistFile,
  assertRenovateFile,
  assertReposFile,
  assertSocialCooldownsFile,
  isAllowlistFile,
  isRenovateFile,
  isReposFile,
  isSocialCooldownsFile,
  SchemaValidationError,
} from './schemas.ts'

function readMetadata(filename: string): unknown {
  return parse(readFileSync(`metadata/${filename}`, 'utf8'))
}

function catchSchemaError(fn: () => void): SchemaValidationError {
  try {
    fn()
  } catch (error) {
    if (error instanceof SchemaValidationError) return error
    throw new Error(`Expected SchemaValidationError, got ${String(error)}`)
  }
  throw new Error('Expected function to throw SchemaValidationError, but it did not throw')
}

describe('schemas — real metadata files', () => {
  it('validates metadata/allowlist.yaml', () => {
    const data = readMetadata('allowlist.yaml')
    expect(isAllowlistFile(data)).toBe(true)
    expect(() => assertAllowlistFile(data)).not.toThrow()
  })

  it('validates metadata/repos.yaml', () => {
    const data = readMetadata('repos.yaml')
    expect(isReposFile(data)).toBe(true)
    expect(() => assertReposFile(data)).not.toThrow()
  })

  it('validates metadata/renovate.yaml', () => {
    const data = readMetadata('renovate.yaml')
    expect(isRenovateFile(data)).toBe(true)
    expect(() => assertRenovateFile(data)).not.toThrow()
  })

  it('validates metadata/social-cooldowns.yaml', () => {
    const data = readMetadata('social-cooldowns.yaml')
    expect(isSocialCooldownsFile(data)).toBe(true)
    expect(() => assertSocialCooldownsFile(data)).not.toThrow()
  })
})

describe('schemas — rejection cases', () => {
  it('rejects null input', () => {
    expect(isAllowlistFile(null)).toBe(false)
    expect(() => assertAllowlistFile(null)).toThrow(SchemaValidationError)
  })

  it('rejects wrong version number', () => {
    const bad = {version: 2, approved_inviters: []}
    expect(isAllowlistFile(bad)).toBe(false)
    expect(() => assertAllowlistFile(bad)).toThrow(SchemaValidationError)
    const error = catchSchemaError(() => assertAllowlistFile(bad))
    expect(error.path).toBe('allowlist.version')
  })

  it('rejects missing required field', () => {
    const bad = {version: 1}
    expect(isAllowlistFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertAllowlistFile(bad))
    expect(error.path).toContain('approved_inviters')
  })

  it('rejects wrong field type in repos', () => {
    const bad = {version: 1, repos: [{name: 123, status: 'active'}]}
    expect(isReposFile(bad)).toBe(false)
    expect(() => assertReposFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects invalid onboarding_status enum', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2025-01-01',
          onboarding_status: 'invalid',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('onboarding_status')
  })

  it('accepts lost-access onboarding_status', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'lost-access',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('accepts pending-review onboarding_status', () => {
    const ok = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'pending-review',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
      ],
    }
    expect(isReposFile(ok)).toBe(true)
    expect(() => assertReposFile(ok)).not.toThrow()
  })

  it('rejects archived as an onboarding_status (not in the enum)', () => {
    const bad = {
      version: 1,
      repos: [
        {
          owner: 'fro-bot',
          name: 'test',
          added: '2026-04-17',
          onboarding_status: 'archived',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: false,
          has_renovate: false,
        },
      ],
    }
    expect(isReposFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertReposFile(bad))
    expect(error.path).toContain('onboarding_status')
  })

  it('rejects non-string entry in with-renovate list', () => {
    const bad = {repositories: {'with-renovate': ['valid', 42]}}
    expect(isRenovateFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertRenovateFile(bad))
    expect(error.path).toContain('with-renovate[1]')
  })

  it('rejects missing repositories key in renovate file', () => {
    const bad = {version: 1, repos: ['agent']}
    expect(isRenovateFile(bad)).toBe(false)
    expect(() => assertRenovateFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects non-array with-renovate in renovate file', () => {
    const bad = {repositories: {'with-renovate': 'not-an-array'}}
    expect(isRenovateFile(bad)).toBe(false)
    expect(() => assertRenovateFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects invalid cooldown entry (missing last_broadcast_at)', () => {
    const bad = {version: 1, cooldowns: {pr_review: {repo: 'fro-bot/.github'}}}
    expect(isSocialCooldownsFile(bad)).toBe(false)
    const error = catchSchemaError(() => assertSocialCooldownsFile(bad))
    expect(error.path).toContain('last_broadcast_at')
  })

  it('SchemaValidationError has correct shape', () => {
    const error = catchSchemaError(() => assertAllowlistFile('not an object'))
    expect(error.name).toBe('SchemaValidationError')
    expect(typeof error.path).toBe('string')
    expect(error.message).toContain(error.path)
  })
})
