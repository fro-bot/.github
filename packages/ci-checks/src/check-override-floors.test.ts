import type {execFileSync} from 'node:child_process'

import type {AuditRunResult} from './check-override-floors.ts'

import {Buffer} from 'node:buffer'
import {describe, expect, it} from 'vitest'
import {checkOverrideFloors, formatProblem, parseAuditOutput, runBunAudit} from './check-override-floors.ts'

function record(overrides: Partial<{id: unknown; severity: unknown; vulnerable_versions: unknown}> = {}): unknown {
  return {
    id: 1000000,
    url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
    title: 'An advisory',
    severity: 'high',
    vulnerable_versions: '<4.1.3',
    ...overrides,
  }
}

function auditOf(advisories: Record<string, unknown>): () => AuditRunResult {
  return () => ({ok: true, advisories})
}

describe('parseAuditOutput', () => {
  it('fails closed on output that is not valid JSON', () => {
    expect(parseAuditOutput('not json').ok).toBe(false)
  })

  it('fails closed on empty output', () => {
    expect(parseAuditOutput('').ok).toBe(false)
  })

  it.each(['[]', 'null', '"text"', '42'])('fails closed when the top level is not a package map (%s)', stdout => {
    expect(parseAuditOutput(stdout).ok).toBe(false)
  })

  it('treats {} as an empty package map', () => {
    expect(parseAuditOutput('{}')).toEqual({ok: true, advisories: {}})
  })

  it('succeeds on a package map, keeping every package and its records', () => {
    const result = parseAuditOutput(JSON.stringify({lodash: [record()], minimist: [record({severity: 'critical'})]}))
    expect(result).toEqual({ok: true, advisories: {lodash: [record()], minimist: [record({severity: 'critical'})]}})
  })
})

describe('runBunAudit', () => {
  it('runs `bun audit --json` and parses its stdout', () => {
    const calls: unknown[][] = []
    const exec = ((...args: unknown[]) => {
      calls.push(args)
      return '{}'
    }) as unknown as typeof execFileSync

    expect(runBunAudit(exec)).toEqual({ok: true, advisories: {}})
    expect(calls).toEqual([['bun', ['audit', '--json'], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}]])
  })

  it('recovers the audit payload from a non-zero exit', () => {
    const exec = (() => {
      throw Object.assign(new Error('exit 1'), {stdout: JSON.stringify({lodash: [record()]})})
    }) as unknown as typeof execFileSync

    expect(runBunAudit(exec)).toEqual({ok: true, advisories: {lodash: [record()]}})
  })

  it('recovers a Buffer payload from a non-zero exit', () => {
    const exec = (() => {
      throw Object.assign(new Error('exit 1'), {stdout: Buffer.from('{}')})
    }) as unknown as typeof execFileSync

    expect(runBunAudit(exec)).toEqual({ok: true, advisories: {}})
  })

  it('fails closed when a non-zero exit carries empty stdout (registry failure, no lockfile)', () => {
    const exec = (() => {
      throw Object.assign(new Error('exit 1'), {stdout: ''})
    }) as unknown as typeof execFileSync

    const result = runBunAudit(exec)
    expect(result.ok).toBe(false)
  })

  it('fails closed when bun could not be spawned (no captured stdout)', () => {
    const exec = (() => {
      throw new Error('spawn bun ENOENT')
    }) as unknown as typeof execFileSync

    expect(runBunAudit(exec)).toEqual({ok: false, reason: 'bun audit could not be executed: spawn bun ENOENT'})
  })
})

describe('checkOverrideFloors', () => {
  it('passes on {} (a clean tree)', () => {
    expect(checkOverrideFloors({runAudit: auditOf({})})).toEqual({ok: true, problems: []})
  })

  it('passes when the map holds only moderate or low records', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({
        '@humanfs/node': [record({severity: 'moderate'})],
        katex: [record({severity: 'low'}), record({severity: 'moderate'})],
      }),
    })

    expect(result).toEqual({ok: true, problems: []})
  })

  it('passes an info record', () => {
    expect(checkOverrideFloors({runAudit: auditOf({katex: [record({severity: 'info'})]})})).toEqual({
      ok: true,
      problems: [],
    })
  })

  it('fails a high record that carries no url, with url left undefined', () => {
    const withoutUrl = {id: 1000000, severity: 'high', vulnerable_versions: '<4.1.3'}
    const result = checkOverrideFloors({runAudit: auditOf({'fast-uri': [withoutUrl]})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'blocking-advisory',
        packageName: 'fast-uri',
        advisoryId: 1000000,
        severity: 'high',
        vulnerableVersions: '<4.1.3',
        url: undefined,
      },
    ])
  })

  it('ignores a url that is not a string', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({'fast-uri': [{id: 1, severity: 'high', vulnerable_versions: '<4.1.3', url: 42}]}),
    })

    expect(result.problems).toEqual([expect.objectContaining({kind: 'blocking-advisory', url: undefined})])
  })

  it('passes a package whose record list is empty', () => {
    expect(checkOverrideFloors({runAudit: auditOf({lodash: []})})).toEqual({ok: true, problems: []})
  })

  it('fails on a high record, naming package, advisory id, severity and vulnerable range', () => {
    const result = checkOverrideFloors({runAudit: auditOf({'fast-uri': [record()]})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'blocking-advisory',
        packageName: 'fast-uri',
        advisoryId: 1000000,
        severity: 'high',
        vulnerableVersions: '<4.1.3',
        url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
      },
    ])
  })

  it('fails on a critical record', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({
        minimist: [record({id: 1097678, severity: 'critical', vulnerable_versions: '>=1.0.0 <1.2.6'})],
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'blocking-advisory',
        packageName: 'minimist',
        advisoryId: 1097678,
        severity: 'critical',
        vulnerableVersions: '>=1.0.0 <1.2.6',
        url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
      },
    ])
  })

  it('fails on a high record that sits beside a moderate one, and reports only the high one', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({lodash: [record({severity: 'moderate'}), record({id: 7, severity: 'high'})]}),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'blocking-advisory',
        packageName: 'lodash',
        advisoryId: 7,
        severity: 'high',
        vulnerableVersions: '<4.1.3',
        url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
      },
    ])
  })

  it('reports every blocking record across packages', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({
        lodash: [record({id: 1})],
        minimist: [record({id: 2, severity: 'critical'})],
      }),
    })

    expect(result.problems.map(problem => ('packageName' in problem ? problem.packageName : undefined))).toEqual([
      'lodash',
      'minimist',
    ])
  })

  it('fails closed on an unknown severity', () => {
    const result = checkOverrideFloors({runAudit: auditOf({'fast-uri': [record({severity: 'catastrophic'})]})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {kind: 'unrecognized-severity', packageName: 'fast-uri', advisoryId: 1000000, severity: 'catastrophic'},
    ])
  })

  it('fails closed on a record without severity', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({'fast-uri': [{id: 1, vulnerable_versions: '<4.1.3'}]}),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 0}])
  })

  it('fails closed on a record without vulnerable_versions', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({'fast-uri': [record({severity: 'moderate'}), {id: 1, severity: 'moderate'}]}),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 1}])
  })

  it('fails closed on a record without an id', () => {
    const result = checkOverrideFloors({
      runAudit: auditOf({'fast-uri': [{severity: 'moderate', vulnerable_versions: '<4.1.3'}]}),
    })

    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 0}])
  })

  it('accepts a string advisory id', () => {
    const result = checkOverrideFloors({runAudit: auditOf({'fast-uri': [record({id: 'GHSA-xxxx', severity: 'low'})]})})

    expect(result).toEqual({ok: true, problems: []})
  })

  it.each([null, 'text', 42, ['nested']])('fails closed on a record that is not an object (%j)', value => {
    const result = checkOverrideFloors({runAudit: auditOf({'fast-uri': [value]})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 0}])
  })

  it.each([{}, 'text', null, 42])('fails closed on a package entry that is not an array (%j)', entry => {
    const result = checkOverrideFloors({runAudit: auditOf({'fast-uri': entry})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-package-entry', packageName: 'fast-uri'}])
  })

  it('fails when the audit output does not parse', () => {
    const result = checkOverrideFloors({runAudit: () => ({ok: false, reason: 'boom'})})

    expect(result).toEqual({ok: false, problems: [], auditFailure: 'boom'})
  })

  it('fails when bun audit could not be executed (no parseable stdout)', () => {
    const result = checkOverrideFloors({
      runAudit: () => ({ok: false, reason: 'bun audit could not be executed: spawn bun ENOENT'}),
    })

    expect(result.ok).toBe(false)
    expect(result.auditFailure).toMatch(/ENOENT/)
  })
})

describe('formatProblem', () => {
  it('names the package, advisory id, severity and vulnerable range of a blocking advisory', () => {
    expect(
      formatProblem({
        kind: 'blocking-advisory',
        packageName: 'ajv',
        advisoryId: 1106913,
        severity: 'high',
        vulnerableVersions: '<6.14.0',
        url: 'https://github.com/advisories/GHSA-2g4f-4pwh-qvx6',
      }),
    ).toBe(
      'ajv: advisory 1106913 (HIGH) affects an installed version in vulnerable range "<6.14.0"; advisory: https://github.com/advisories/GHSA-2g4f-4pwh-qvx6',
    )
  })

  it('omits the advisory URL when the record has none', () => {
    expect(
      formatProblem({
        kind: 'blocking-advisory',
        packageName: 'ajv',
        advisoryId: 1106913,
        severity: 'high',
        vulnerableVersions: '<6.14.0',
        url: undefined,
      }),
    ).toBe('ajv: advisory 1106913 (HIGH) affects an installed version in vulnerable range "<6.14.0"')
  })

  it('names the package, advisory id and severity of an unrecognized severity', () => {
    expect(
      formatProblem({kind: 'unrecognized-severity', packageName: 'ajv', advisoryId: 'GHSA-1', severity: 'weird'}),
    ).toBe('ajv: advisory GHSA-1 has an unrecognized severity "weird"')
  })

  it('names the package of an unparseable package entry', () => {
    expect(formatProblem({kind: 'unparseable-package-entry', packageName: 'ajv'})).toBe(
      'ajv: bun audit entry is not an array of advisory records',
    )
  })

  it('names the package and index of an unparseable advisory record', () => {
    expect(formatProblem({kind: 'unparseable-advisory-record', packageName: 'ajv', index: 3})).toBe(
      'ajv: bun audit advisory record at index 3 is missing required fields (id, severity, vulnerable_versions)',
    )
  })
})
