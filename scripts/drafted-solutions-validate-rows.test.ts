import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {afterEach, describe, expect, it} from 'vitest'

import {FIELD_LIMITS, hashProposalBody} from './drafted-solutions-pr-body.ts'
import {checkAgentRows, DIGEST_VERSION, type DraftedDigest} from './drafted-solutions-shared.ts'
import {validateDraftedRows} from './drafted-solutions-validate-rows.ts'

const SCRIPT = path.resolve(import.meta.dirname, 'drafted-solutions-validate-rows.ts')
const SHA = 'a'.repeat(40)
const DOC = 'docs/solutions/best-practices/example-2026-10-09.md'

function digestOf(...issues: number[]): DraftedDigest {
  return {
    version: DIGEST_VERSION,
    draftBaseSha: SHA,
    mainSha: SHA,
    proposals: issues.map(issue => ({
      issue,
      title: `Proposal ${issue}`,
      body: `Lesson ${issue}`,
      bodyHash: hashProposalBody(`Lesson ${issue}`),
      mergeSha: 'b'.repeat(40),
      createdAt: '2026-10-01T00:00:00Z',
    })),
    pr: {state: 'none'},
  }
}

/** A row as the prompt instructs the agent to write it: no bodyHash. */
function agentRow(issue: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issue,
    outcome: 'new-doc',
    targetDoc: DOC,
    sourceSha: SHA,
    evidence: [{kind: 'pr', ref: '#3868'}],
    droppedClaims: [],
    reason: '',
    ...overrides,
  }
}

describe('validateDraftedRows', () => {
  it('accepts a prompt-compliant row set, one row per digest proposal', () => {
    const rows = [
      agentRow(11),
      agentRow(12, {outcome: 'covered', evidence: [], reason: 'Already documented.'}),
      agentRow(13, {outcome: 'unverified', targetDoc: null, evidence: [], reason: 'No merged PR found.'}),
    ]

    expect(validateDraftedRows(rows, digestOf(11, 12, 13))).toStrictEqual({ok: true, count: 3, errors: []})
  })

  it('accepts rows at exactly the documented limits', () => {
    const {maxEvidence, maxClaims, maxRef, maxClaim, maxReason} = FIELD_LIMITS
    const row = agentRow(11, {
      evidence: Array.from({length: maxEvidence}, () => ({kind: 'review', ref: 'r'.repeat(maxRef)})),
      droppedClaims: Array.from({length: maxClaims}, () => 'c'.repeat(maxClaim)),
      reason: 'x'.repeat(maxReason),
    })

    expect(validateDraftedRows([row], digestOf(11)).ok).toBe(true)
  })

  it('rejects a row with four dropped claims, naming the issue and the count message', () => {
    const row = agentRow(11, {droppedClaims: ['a', 'b', 'c', 'd']})

    const result = validateDraftedRows([row], digestOf(11))

    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/^#11: /)
    expect(result.errors[0]).toContain('droppedClaims has more than 3 entries')
  })

  it('reports every bad row, each under its own issue number', () => {
    const rows = [agentRow(11, {droppedClaims: ['a', 'b', 'c', 'd']}), agentRow(12, {evidence: []}), agentRow(13)]

    const result = validateDraftedRows(rows, digestOf(11, 12, 13))

    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.split(':')[0])).toStrictEqual(['#11', '#12'])
  })

  it('reports an over-long field with its cap', () => {
    const result = validateDraftedRows([agentRow(11, {reason: 'x'.repeat(FIELD_LIMITS.maxReason + 1)})], digestOf(11))

    expect(result.errors[0]).toMatch(/^#11: .*reason.*300/)
  })

  it('rejects a missing row, an extra row, and a duplicate row', () => {
    const missing = validateDraftedRows([agentRow(11)], digestOf(11, 12))
    const extra = validateDraftedRows([agentRow(11), agentRow(99)], digestOf(11))
    const duplicate = validateDraftedRows([agentRow(11), agentRow(11)], digestOf(11))

    expect(missing.errors).toStrictEqual(['no evidence row for proposal #12'])
    expect(extra.errors).toStrictEqual(['row for #99 is not in the digest'])
    expect(duplicate.errors).toStrictEqual(['duplicate row for issue #11'])
  })

  it('rejects rows that are not an array', () => {
    expect(validateDraftedRows({}, digestOf(11)).errors).toStrictEqual([
      'rows file must be a JSON array of coverage rows',
    ])
  })

  it('applies the same validation publish uses (it is the shared checkAgentRows)', () => {
    const rows = [agentRow(11, {droppedClaims: ['a', 'b', 'c', 'd']})]

    const shared = checkAgentRows(rows, digestOf(11))

    expect(shared.ok).toBe(false)
    expect(validateDraftedRows(rows, digestOf(11)).errors).toStrictEqual(shared.ok ? [] : shared.errors)
  })
})

describe('drafted-solutions-validate-rows CLI', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
  })

  function runCli(rows: unknown, digest: DraftedDigest, env: Record<string, string> = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'validate-rows-'))
    dirs.push(dir)
    mkdirSync(path.join(dir, '.drafted-solutions'))
    writeFileSync(
      path.join(dir, '.drafted-solutions/rows.json'),
      typeof rows === 'string' ? rows : JSON.stringify(rows),
    )
    writeFileSync(path.join(dir, '.drafted-solutions/drafted-solutions-digest.json'), JSON.stringify(digest))
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        cwd: dir,
        // No GITHUB_TOKEN and no network: the CLI must work with nothing but the two files.
        env: {PATH: process.env.PATH ?? '', ...env},
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return {status: 0, stdout, stderr: ''}
    } catch (error: unknown) {
      const failure = error as {status?: number; stdout?: string; stderr?: string}
      return {status: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '')}
    }
  }

  it('exits 0 for valid rows at the default workspace paths', () => {
    const result = runCli([agentRow(11)], digestOf(11))

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('1 row')
  })

  it('exits 1 and prints each error with its issue number', () => {
    const result = runCli(
      [agentRow(11, {droppedClaims: ['a', 'b', 'c', 'd']}), agentRow(12, {evidence: []})],
      digestOf(11, 12),
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('#11: ')
    expect(result.stderr).toContain('droppedClaims has more than 3 entries')
    expect(result.stderr).toContain('#12: ')
  })

  it('exits 1 for unreadable or non-JSON input', () => {
    const result = runCli('{not json', digestOf(11))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('rows')
  })

  it('honors path overrides from the environment', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'validate-rows-env-'))
    dirs.push(dir)
    writeFileSync(path.join(dir, 'r.json'), JSON.stringify([agentRow(11)]))
    writeFileSync(path.join(dir, 'd.json'), JSON.stringify(digestOf(11)))

    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: dir,
      env: {
        PATH: process.env.PATH ?? '',
        DRAFTED_SOLUTIONS_ROWS_PATH: 'r.json',
        DRAFTED_SOLUTIONS_DIGEST_PATH: 'd.json',
      },
      encoding: 'utf8',
    })

    expect(stdout).toContain('1 row')
  })
})
