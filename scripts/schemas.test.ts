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
} from './schemas.js'

function readMetadata(filename: string): unknown {
  return parse(readFileSync(`metadata/${filename}`, 'utf8'))
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
    try {
      assertAllowlistFile(bad)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      expect((error as SchemaValidationError).path).toBe('allowlist.version')
    }
  })

  it('rejects missing required field', () => {
    const bad = {version: 1}
    expect(isAllowlistFile(bad)).toBe(false)
    try {
      assertAllowlistFile(bad)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      expect((error as SchemaValidationError).path).toContain('approved_inviters')
    }
  })

  it('rejects wrong field type in repos', () => {
    const bad = {version: 1, repos: [{name: 123, status: 'active'}]}
    expect(isReposFile(bad)).toBe(false)
    expect(() => assertReposFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects invalid onboarding_status enum', () => {
    const bad = {version: 1, repos: [{name: 'test', status: 'active', onboarding_status: 'invalid'}]}
    expect(isReposFile(bad)).toBe(false)
  })

  it('rejects invalid renovate dispatch_status enum', () => {
    const bad = {version: 1, repos: [{name: 'test', has_renovate: true, dispatch_status: 'bogus'}]}
    expect(isRenovateFile(bad)).toBe(false)
  })

  it('rejects non-array repos in renovate file', () => {
    const bad = {version: 1, repos: 'not-an-array'}
    expect(isRenovateFile(bad)).toBe(false)
    expect(() => assertRenovateFile(bad)).toThrow(SchemaValidationError)
  })

  it('rejects invalid event_type in social cooldowns', () => {
    const bad = {version: 1, cooldowns: [{event_type: 123, min_interval_minutes: 60}]}
    expect(isSocialCooldownsFile(bad)).toBe(false)
    expect(() => assertSocialCooldownsFile(bad)).toThrow(SchemaValidationError)
  })

  it('SchemaValidationError has correct shape', () => {
    try {
      assertAllowlistFile('not an object')
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      const e = error as SchemaValidationError
      expect(e.name).toBe('SchemaValidationError')
      expect(typeof e.path).toBe('string')
      expect(e.message).toContain(e.path)
    }
  })
})
