/**
 * Tests for the redacted canonical ID helpers: which private-entry IDs are denylisted, and the
 * fail-closed disk loader.
 */

import {describe, expect, it} from 'vitest'
import {extractRedactedCanonicalIds, loadRedactedCanonicalIdsFromDisk} from './redacted-ids.ts'

// ---------------------------------------------------------------------------
// extractRedactedCanonicalIds — pure helper
// ---------------------------------------------------------------------------

describe('extractRedactedCanonicalIds', () => {
  it('extracts node_id from private entries', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: 'R_kgDOFIXTURE001',
        private: true,
        node_id: 'R_kgDOFIXTURE001',
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('R_kgDOFIXTURE001')).toBe(true)
  })

  it('extracts database_id as string from private entries', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: 'R_kgDOFIXTURE002',
        private: true,
        node_id: 'R_kgDOFIXTURE002',
        database_id: 987654321,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('987654321')).toBe(true)
  })

  it('does NOT include node_id or database_id from public (non-private) entries', () => {
    const repos = [
      {
        owner: 'fro-bot',
        name: 'public-repo',
        private: false,
        node_id: 'R_kgDOPUBLIC001',
        database_id: 111111111,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('R_kgDOPUBLIC001')).toBe(false)
    expect(ids.has('111111111')).toBe(false)
  })

  it('does NOT include IDs from entries where private is undefined (treat-as-private fail-safe: excluded from redactedCanonicalIds)', () => {
    // Entries with private===undefined have no confirmed canonical IDs to redact
    // (they have no node_id in practice). They are excluded from redactedCanonicalIds.
    const repos = [
      {
        owner: 'fro-bot',
        name: 'legacy-repo',
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.size).toBe(0)
  })

  it('returns empty set for empty repos array', () => {
    const ids = extractRedactedCanonicalIds([])
    expect(ids.size).toBe(0)
  })

  it('includes both node_id and database_id when both are present on a private entry', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: 'R_kgDOFIXTURE003',
        private: true,
        node_id: 'R_kgDOFIXTURE003',
        database_id: 123456789,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('R_kgDOFIXTURE003')).toBe(true)
    expect(ids.has('123456789')).toBe(true)
    expect(ids.size).toBe(2)
  })

  it('handles private entry with no node_id or database_id gracefully (empty contribution)', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: '[REDACTED]',
        private: true,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// loadRedactedCanonicalIdsFromDisk — disk loader
// ---------------------------------------------------------------------------

describe('loadRedactedCanonicalIdsFromDisk', () => {
  it('loads node_id and database_id from private entries in a fixture YAML', async () => {
    const fixtureYaml = `
version: 1
repos:
  - owner: "[REDACTED]"
    name: "R_kgDOFIXTURE001"
    private: true
    node_id: "R_kgDOFIXTURE001"
    database_id: 987654321
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const ids = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    expect(ids.has('R_kgDOFIXTURE001')).toBe(true)
    expect(ids.has('987654321')).toBe(true)
  })

  it('returns empty set when no private entries exist', async () => {
    const fixtureYaml = `
version: 1
repos:
  - owner: "fro-bot"
    name: "public-repo"
    private: false
    node_id: "R_kgDOPUBLIC001"
    database_id: 111111111
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const ids = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    expect(ids.size).toBe(0)
  })

  it('throws when the file cannot be read (fail-closed)', async () => {
    const readFileFn = async (_path: string, _enc: BufferEncoding): Promise<string> => {
      throw new Error('ENOENT: no such file or directory')
    }
    await expect(loadRedactedCanonicalIdsFromDisk(readFileFn)).rejects.toThrow()
  })

  it('throws when the YAML is malformed (fail-closed)', async () => {
    const readFileFn = async (_path: string, _enc: BufferEncoding) => '{ invalid yaml: ['
    await expect(loadRedactedCanonicalIdsFromDisk(readFileFn)).rejects.toThrow()
  })

  it('throws when the YAML has wrong schema (fail-closed)', async () => {
    const readFileFn = async (_path: string, _enc: BufferEncoding) => 'version: 2\nrepos: []'
    await expect(loadRedactedCanonicalIdsFromDisk(readFileFn)).rejects.toThrow()
  })

  it('does not include public repo IDs even when node_id is present', async () => {
    const fixtureYaml = `
version: 1
repos:
  - owner: "fro-bot"
    name: "public-repo"
    private: false
    node_id: "R_kgDOPUBLIC999"
    database_id: 999999999
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
  - owner: "[REDACTED]"
    name: "R_kgDOFIXTURE004"
    private: true
    node_id: "R_kgDOFIXTURE004"
    database_id: 444444444
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const ids = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    // Private entry IDs present
    expect(ids.has('R_kgDOFIXTURE004')).toBe(true)
    expect(ids.has('444444444')).toBe(true)
    // Public entry IDs absent
    expect(ids.has('R_kgDOPUBLIC999')).toBe(false)
    expect(ids.has('999999999')).toBe(false)
  })
})
