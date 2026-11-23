import type {execFileSync} from 'node:child_process'
import type {readFileSync} from 'node:fs'

import type {AcceptedAdvisoriesResult, AcceptedAdvisory, AuditRunResult} from './check-override-floors.ts'

import {Buffer} from 'node:buffer'
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, join} from 'node:path'
import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {
  checkOverrideFloors,
  formatProblem,
  formatSkippedAdvisory,
  formatUnmatchedAcceptance,
  parseAcceptedAdvisories,
  parseAuditOutput,
  readAcceptedAdvisories,
  runBunAudit,
  runCheckOverrideFloors,
} from './check-override-floors.ts'

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

const noAccepted = (): AcceptedAdvisoriesResult => ({ok: true, entries: []})

/** `checkOverrideFloors` with no accepted advisories unless a test says otherwise, so no test reads the real file. */
function check(options: Parameters<typeof checkOverrideFloors>[0] = {}): ReturnType<typeof checkOverrideFloors> {
  return checkOverrideFloors({readAccepted: noAccepted, ...options})
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
    expect(check({runAudit: auditOf({})})).toEqual({ok: true, problems: [], skipped: [], unmatched: []})
  })

  it('passes when the map holds only moderate or low records', () => {
    const result = check({
      runAudit: auditOf({
        '@humanfs/node': [record({severity: 'moderate'})],
        katex: [record({severity: 'low'}), record({severity: 'moderate'})],
      }),
    })

    expect(result).toEqual({ok: true, problems: [], skipped: [], unmatched: []})
  })

  it('passes an info record', () => {
    expect(check({runAudit: auditOf({katex: [record({severity: 'info'})]})})).toEqual({
      ok: true,
      problems: [],
      skipped: [],
      unmatched: [],
    })
  })

  it('fails a high record that carries no url, with url left undefined', () => {
    const withoutUrl = {id: 1000000, severity: 'high', vulnerable_versions: '<4.1.3'}
    const result = check({runAudit: auditOf({'fast-uri': [withoutUrl]})})

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
    const result = check({
      runAudit: auditOf({'fast-uri': [{id: 1, severity: 'high', vulnerable_versions: '<4.1.3', url: 42}]}),
    })

    expect(result.problems).toEqual([expect.objectContaining({kind: 'blocking-advisory', url: undefined})])
  })

  it('passes a package whose record list is empty', () => {
    expect(check({runAudit: auditOf({lodash: []})})).toEqual({ok: true, problems: [], skipped: [], unmatched: []})
  })

  it('fails on a high record, naming package, advisory id, severity and vulnerable range', () => {
    const result = check({runAudit: auditOf({'fast-uri': [record()]})})

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
    const result = check({
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
    const result = check({
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
    const result = check({
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
    const result = check({runAudit: auditOf({'fast-uri': [record({severity: 'catastrophic'})]})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {kind: 'unrecognized-severity', packageName: 'fast-uri', advisoryId: 1000000, severity: 'catastrophic'},
    ])
  })

  it('fails closed on a record without severity', () => {
    const result = check({
      runAudit: auditOf({'fast-uri': [{id: 1, vulnerable_versions: '<4.1.3'}]}),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 0}])
  })

  it('fails closed on a record without vulnerable_versions', () => {
    const result = check({
      runAudit: auditOf({'fast-uri': [record({severity: 'moderate'}), {id: 1, severity: 'moderate'}]}),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 1}])
  })

  it('fails closed on a record without an id', () => {
    const result = check({
      runAudit: auditOf({'fast-uri': [{severity: 'moderate', vulnerable_versions: '<4.1.3'}]}),
    })

    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 0}])
  })

  it('accepts a string advisory id', () => {
    const result = check({runAudit: auditOf({'fast-uri': [record({id: 'GHSA-xxxx', severity: 'low'})]})})

    expect(result).toEqual({ok: true, problems: [], skipped: [], unmatched: []})
  })

  it.each([null, 'text', 42, ['nested']])('fails closed on a record that is not an object (%j)', value => {
    const result = check({runAudit: auditOf({'fast-uri': [value]})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', packageName: 'fast-uri', index: 0}])
  })

  it.each([{}, 'text', null, 42])('fails closed on a package entry that is not an array (%j)', entry => {
    const result = check({runAudit: auditOf({'fast-uri': entry})})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-package-entry', packageName: 'fast-uri'}])
  })

  it('fails when the audit output does not parse', () => {
    const result = check({runAudit: () => ({ok: false, reason: 'boom'})})

    expect(result).toEqual({ok: false, problems: [], skipped: [], unmatched: [], auditFailure: 'boom'})
  })

  it('fails when bun audit could not be executed (no parseable stdout)', () => {
    const result = check({
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

/** The failure reason of a result that must be a failure; fails the test otherwise. */
function failureReason(result: AuditRunResult): string {
  if (result.ok) throw new Error('expected a failed audit run')
  return result.reason
}

describe('the parse failure and exec failure reasons', () => {
  it('names a JSON parse failure with the parser message and a wrong shape with the expected shape', () => {
    expect(failureReason(parseAuditOutput('{ nope'))).toMatch(/^bun audit output did not parse as JSON: .+/u)
    expect(failureReason(parseAuditOutput(''))).toMatch(/^bun audit output did not parse as JSON: .+/u)
    expect(failureReason(parseAuditOutput('[]'))).toBe(
      'bun audit output did not match the expected shape (a map of package names)',
    )
  })

  it('recovers stdout from a thrown error only when it is a string or a Buffer', () => {
    const throwing = (error: unknown) =>
      (() => {
        throw error
      }) as unknown as typeof execFileSync
    expect(runBunAudit(throwing({stdout: '{}'}))).toEqual({ok: true, advisories: {}})
    expect(runBunAudit(throwing({stdout: Buffer.from('{"a": []}')}))).toEqual({ok: true, advisories: {a: []}})
    for (const error of ['boom', null, 7, {stdout: 7}, {stdout: undefined}, {stdout: ['{}']}]) {
      expect(failureReason(runBunAudit(throwing(error))), String(error)).toMatch(/^bun audit could not be executed: /u)
    }
  })
})

describe('checkOverrideFloors with the default audit', () => {
  it('runs `bun audit --json` from PATH and judges its output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'check-override-floors-bin-'))
    const originalPath = process.env.PATH
    try {
      const bun = join(directory, 'bun')
      writeFileSync(
        bun,
        '#!/usr/bin/env node\nif (process.argv.slice(2).join(" ") !== "audit --json") process.exit(9)\n' +
          'process.stdout.write(JSON.stringify({left: [{id: 1, severity: "high", vulnerable_versions: "<1"}]}))\nprocess.exit(1)\n',
      )
      chmodSync(bun, 0o755)
      process.env.PATH = `${directory}${delimiter}${originalPath ?? ''}`
      const result = checkOverrideFloors({readAccepted: noAccepted})
      expect(result.ok).toBe(false)
      expect(result.problems).toMatchObject([{kind: 'blocking-advisory', packageName: 'left', advisoryId: 1}])
    } finally {
      process.env.PATH = originalPath
      rmSync(directory, {recursive: true, force: true})
    }
  })
})

// ─── Accepted advisories ─────────────────────────────────────────────────────

const picomatchEntry: AcceptedAdvisory = {
  package: 'picomatch',
  advisory: 1247710,
  ghsa: 'GHSA-fc5q-39xc-vjpf',
  reason: 'Dev lint tooling only; no fixed version exists.',
  expires: '2026-12-17',
}

const picomatchRecord = record({id: 1247710, severity: 'high', vulnerable_versions: '<=4.0.7'})

function acceptedOf(...entries: AcceptedAdvisory[]): () => AcceptedAdvisoriesResult {
  return () => ({ok: true, entries})
}

/** A fixed UTC instant on the given day, at the given time of day. */
function at(day: string, time = '12:00:00.000'): () => Date {
  return () => new Date(`${day}T${time}Z`)
}

describe('accepted advisories in the gate', () => {
  it('skips a blocking advisory that matches an entry on package and id, and passes', () => {
    const result = check({
      runAudit: auditOf({picomatch: [picomatchRecord]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result).toEqual({
      ok: true,
      problems: [],
      skipped: [
        {
          packageName: 'picomatch',
          advisoryId: 1247710,
          severity: 'high',
          expires: '2026-12-17',
          reason: 'Dev lint tooling only; no fixed version exists.',
        },
      ],
      unmatched: [],
    })
  })

  it('skips a critical advisory that matches an entry', () => {
    const result = check({
      runAudit: auditOf({picomatch: [record({id: 1247710, severity: 'critical'})]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result.ok).toBe(true)
    expect(result.skipped).toMatchObject([{severity: 'critical'}])
  })

  it('still fails the same package with a different advisory id, and reports the entry as unmatched', () => {
    const result = check({
      runAudit: auditOf({picomatch: [record({id: 1247711, severity: 'high'})]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toMatchObject([{kind: 'blocking-advisory', packageName: 'picomatch', advisoryId: 1247711}])
    expect(result.skipped).toEqual([])
    expect(result.unmatched).toEqual([picomatchEntry])
  })

  it('still fails the same advisory id on a different package, and reports the entry as unmatched', () => {
    const result = check({
      runAudit: auditOf({micromatch: [picomatchRecord]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toMatchObject([{kind: 'blocking-advisory', packageName: 'micromatch', advisoryId: 1247710}])
    expect(result.skipped).toEqual([])
    expect(result.unmatched).toEqual([picomatchEntry])
  })

  it('does not match an advisory id that is the same digits as a string', () => {
    const result = check({
      runAudit: auditOf({picomatch: [record({id: '1247710', severity: 'high'})]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result.ok).toBe(false)
    expect(result.skipped).toEqual([])
  })

  it('skips only the matching record and still fails a second blocking record of the same package', () => {
    const result = check({
      runAudit: auditOf({picomatch: [picomatchRecord, record({id: 5, severity: 'high'})]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toMatchObject([{kind: 'blocking-advisory', advisoryId: 5}])
    expect(result.skipped).toMatchObject([{advisoryId: 1247710}])
    expect(result.unmatched).toEqual([])
  })

  it('does not let an entry excuse an unrecognized severity or an unparseable record', () => {
    const result = check({
      runAudit: auditOf({picomatch: [record({id: 1247710, severity: 'catastrophic'}), {id: 1247710}]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result.problems).toEqual([
      {kind: 'unrecognized-severity', packageName: 'picomatch', advisoryId: 1247710, severity: 'catastrophic'},
      {kind: 'unparseable-advisory-record', packageName: 'picomatch', index: 1},
    ])
    expect(result.unmatched).toEqual([picomatchEntry])
  })

  it('does not count a non-blocking record of the entry’s advisory as a match', () => {
    const result = check({
      runAudit: auditOf({picomatch: [record({id: 1247710, severity: 'moderate'})]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })

    expect(result.ok).toBe(true)
    expect(result.skipped).toEqual([])
    expect(result.unmatched).toEqual([picomatchEntry])
  })

  it('passes on the expiry day itself, at the last millisecond of it', () => {
    const result = check({
      runAudit: auditOf({picomatch: [picomatchRecord]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-12-17', '23:59:59.999'),
    })

    expect(result.ok).toBe(true)
    expect(result.skipped).toHaveLength(1)
  })

  it('fails on the day after the expiry, at its first millisecond: the entry expired and the advisory is blocking again', () => {
    const result = check({
      runAudit: auditOf({picomatch: [picomatchRecord]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-12-18', '00:00:00.000'),
    })

    expect(result.ok).toBe(false)
    expect(result.skipped).toEqual([])
    expect(result.unmatched).toEqual([])
    expect(result.problems).toEqual([
      {
        kind: 'blocking-advisory',
        packageName: 'picomatch',
        advisoryId: 1247710,
        severity: 'high',
        vulnerableVersions: '<=4.0.7',
        url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
      },
      {
        kind: 'accepted-advisory-expired',
        packageName: 'picomatch',
        advisoryId: 1247710,
        ghsa: 'GHSA-fc5q-39xc-vjpf',
        expires: '2026-12-17',
      },
    ])
  })

  it('fails on an expired entry even when the advisory is no longer reported, so stale entries get removed', () => {
    const result = check({
      runAudit: auditOf({}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2027-01-01'),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'accepted-advisory-expired',
        packageName: 'picomatch',
        advisoryId: 1247710,
        ghsa: 'GHSA-fc5q-39xc-vjpf',
        expires: '2026-12-17',
      },
    ])
    expect(result.unmatched).toEqual([])
  })

  it('judges every entry on its own expiry', () => {
    const later = {...picomatchEntry, package: 'other', advisory: 2, expires: '2027-06-01'}
    const result = check({
      runAudit: auditOf({picomatch: [picomatchRecord], other: [record({id: 2, severity: 'high'})]}),
      readAccepted: acceptedOf(picomatchEntry, later),
      now: at('2026-12-18'),
    })

    expect(result.problems).toMatchObject([
      {kind: 'blocking-advisory', packageName: 'picomatch'},
      {kind: 'accepted-advisory-expired', packageName: 'picomatch'},
    ])
    expect(result.skipped).toMatchObject([{packageName: 'other'}])
  })

  it('passes with the entry unmatched and not expired when the advisory is gone', () => {
    const result = check({runAudit: auditOf({}), readAccepted: acceptedOf(picomatchEntry), now: at('2026-11-17')})

    expect(result).toEqual({ok: true, problems: [], skipped: [], unmatched: [picomatchEntry]})
  })

  it('fails on an invalid accepted file, and the blocking advisory is still reported', () => {
    const result = check({
      runAudit: auditOf({picomatch: [picomatchRecord]}),
      readAccepted: () => ({ok: false, reason: 'accepted-advisories.json is broken'}),
      now: at('2026-11-17'),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toMatchObject([
      {kind: 'blocking-advisory', packageName: 'picomatch'},
      {kind: 'accepted-advisories-invalid', reason: 'accepted-advisories.json is broken'},
    ])
    expect(result.skipped).toEqual([])
  })

  it('does not read the accepted file when the audit could not run', () => {
    let reads = 0
    const result = check({
      runAudit: () => ({ok: false, reason: 'boom'}),
      readAccepted: () => {
        reads += 1
        return {ok: true, entries: []}
      },
    })

    expect(result.auditFailure).toBe('boom')
    expect(reads).toBe(0)
  })

  it('reads the clock once the audit has run, with the real clock by default', () => {
    const future = {...picomatchEntry, expires: '9999-12-31'}
    const past = {...picomatchEntry, package: 'old', advisory: 3, expires: '2000-01-01'}
    const result = check({
      runAudit: auditOf({picomatch: [picomatchRecord]}),
      readAccepted: acceptedOf(future, past),
    })

    expect(result.skipped).toMatchObject([{packageName: 'picomatch'}])
    expect(result.problems).toMatchObject([{kind: 'accepted-advisory-expired', packageName: 'old'}])
  })

  it('treats a missing accepted file as an empty list, so the gate behaves as before', () => {
    inDirectory(directory => {
      expect(readAcceptedAdvisories(join(directory, 'missing.json'))).toEqual({ok: true, entries: []})
    })
  })
})

describe('parseAcceptedAdvisories', () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({...picomatchEntry, ...overrides})
  const parse = (value: unknown) => parseAcceptedAdvisories(JSON.stringify(value))
  const without = (field: string) => Object.fromEntries(Object.entries(entry()).filter(([key]) => key !== field))

  it('parses an empty array and a valid entry', () => {
    expect(parse([])).toEqual({ok: true, entries: []})
    expect(parse([entry()])).toEqual({ok: true, entries: [picomatchEntry]})
  })

  it('keeps only the five fields of an entry', () => {
    expect(parse([entry({extra: 'x'})])).toEqual({ok: true, entries: [picomatchEntry]})
  })

  it('accepts two entries for one package with different ids, and two packages with one id', () => {
    expect(parse([entry(), entry({advisory: 2}), entry({package: 'other'})])).toMatchObject({ok: true})
  })

  it('fails on text that is not JSON, naming the parser message', () => {
    const result = parseAcceptedAdvisories('{ nope')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toMatch(/^accepted-advisories\.json did not parse as JSON: .+/u)
    expect(parseAcceptedAdvisories('').ok).toBe(false)
  })

  it.each([{}, 'text', null, 42])('fails when the top level is not an array (%j)', value => {
    expect(parse(value)).toEqual({ok: false, reason: 'accepted-advisories.json must hold a JSON array of entries'})
  })

  it.each([null, 'text', 42, ['x']])('fails on an entry that is not an object (%j)', value => {
    expect(parse([entry(), value])).toEqual({ok: false, reason: 'accepted-advisories.json entry 1 is not an object'})
  })

  it.each(['package', 'ghsa', 'reason'])('fails when %s is missing, empty or not a string', field => {
    const reason = `accepted-advisories.json entry 0: "${field}" must be a non-empty string`
    expect(parse([without(field)])).toEqual({ok: false, reason})
    for (const value of ['', 7, null, ['x']]) {
      expect(parse([entry({[field]: value})])).toEqual({ok: false, reason})
    }
  })

  it('fails when advisory is missing, not a number or not an integer', () => {
    const reason = 'accepted-advisories.json entry 0: "advisory" must be an integer'
    expect(parse([without('advisory')])).toEqual({ok: false, reason})
    for (const value of ['1247710', 1.5, null, true]) {
      expect(parse([entry({advisory: value})])).toEqual({ok: false, reason})
    }
  })

  it('fails when expires is missing, not a string or not a real YYYY-MM-DD date', () => {
    const reason = 'accepted-advisories.json entry 0: "expires" must be a date written YYYY-MM-DD'
    expect(parse([without('expires')])).toEqual({ok: false, reason})
    for (const value of [
      20261217,
      null,
      '',
      'soon',
      '2026-12-17T00:00:00Z',
      '2026-13-01',
      '2026-02-30',
      '2026-2-3',
      '+012026-12-17',
      ' 2026-12-17',
      '2026-12-17 ',
      '2026/12/17',
    ]) {
      expect(parse([entry({expires: value})]), String(value)).toEqual({ok: false, reason})
    }
  })

  it('accepts a leap day and rejects it in a year without one', () => {
    expect(parse([entry({expires: '2028-02-29'})])).toMatchObject({ok: true})
    expect(parse([entry({expires: '2027-02-29'})]).ok).toBe(false)
  })

  it('fails on a duplicate package and advisory, naming the second entry', () => {
    expect(parse([entry(), entry({advisory: 2}), entry({ghsa: 'GHSA-other', reason: 'again'})])).toEqual({
      ok: false,
      reason: 'accepted-advisories.json entry 2 repeats picomatch advisory 1247710',
    })
  })

  it('reports the first problem entry by its index', () => {
    expect(parse([entry(), entry({reason: ''}), entry({ghsa: ''})])).toEqual({
      ok: false,
      reason: 'accepted-advisories.json entry 1: "reason" must be a non-empty string',
    })
  })
})

function inDirectory<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'check-override-floors-accepted-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
}

describe('readAcceptedAdvisories', () => {
  it('reads and parses the file at the given path', () => {
    inDirectory(directory => {
      const path = join(directory, 'accepted.json')
      writeFileSync(path, JSON.stringify([picomatchEntry]))
      expect(readAcceptedAdvisories(path)).toEqual({ok: true, entries: [picomatchEntry]})
    })
  })

  it('reads the path as UTF-8 text', () => {
    const calls: unknown[][] = []
    const read = ((...args: unknown[]) => {
      calls.push(args)
      return JSON.stringify([picomatchEntry])
    }) as unknown as typeof readFileSync

    expect(readAcceptedAdvisories('/x/accepted.json', read)).toEqual({ok: true, entries: [picomatchEntry]})
    expect(calls).toEqual([['/x/accepted.json', 'utf8']])
  })

  it('fails on a file that is not valid JSON', () => {
    inDirectory(directory => {
      const path = join(directory, 'accepted.json')
      writeFileSync(path, '[')
      expect(readAcceptedAdvisories(path).ok).toBe(false)
    })
  })

  it('fails, rather than treating the list as empty, when the path cannot be read as a file', () => {
    inDirectory(directory => {
      const result = readAcceptedAdvisories(directory)
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.reason).toMatch(/^accepted-advisories\.json could not be read: .+/u)
    })
  })

  it('reads the committed file: it parses, and the withdrawn picomatch advisory is no longer accepted', () => {
    const result = readAcceptedAdvisories()
    expect(result.ok).toBe(true)
    const entries = result.ok ? result.entries : []
    expect(entries.find(entry => entry.package === 'picomatch' && entry.advisory === 1247710)).toBeUndefined()

    const gate = checkOverrideFloors({
      runAudit: auditOf({picomatch: [picomatchRecord]}),
      now: at('2026-11-19'),
    })
    expect(gate.ok).toBe(false)
    expect(gate.skipped).toEqual([])
  })
})

describe('the accepted-advisory messages', () => {
  it('formats a skipped advisory as the line the gate prints', () => {
    expect(
      formatSkippedAdvisory({
        packageName: 'picomatch',
        advisoryId: 1247710,
        severity: 'high',
        expires: '2026-12-17',
        reason: 'Dev lint tooling only.',
      }),
    ).toBe('picomatch: advisory 1247710 (HIGH) accepted until 2026-12-17: Dev lint tooling only.')
  })

  it('formats the notice for an entry that matches no reported advisory', () => {
    expect(formatUnmatchedAcceptance(picomatchEntry)).toBe(
      'notice: picomatch: accepted advisory 1247710 (GHSA-fc5q-39xc-vjpf) matches no reported advisory; remove its entry from accepted-advisories.json once the fix has landed',
    )
  })

  it('formats an expired entry and an invalid file as problems', () => {
    expect(
      formatProblem({
        kind: 'accepted-advisory-expired',
        packageName: 'picomatch',
        advisoryId: 1247710,
        ghsa: 'GHSA-fc5q-39xc-vjpf',
        expires: '2026-12-17',
      }),
    ).toBe(
      'picomatch: accepted advisory 1247710 (GHSA-fc5q-39xc-vjpf) expired on 2026-12-17; remove its entry from accepted-advisories.json or renew it after review',
    )
    expect(formatProblem({kind: 'accepted-advisories-invalid', reason: 'accepted-advisories.json is broken'})).toBe(
      'accepted-advisories.json is broken',
    )
  })

  it('prints a skipped line and a notice before the problems, and exits 1 only on a problem', () => {
    const written: string[] = []
    const write = (text: string) => written.push(text)
    const unused = {...picomatchEntry, package: 'old', advisory: 9}

    const clean = runCheckOverrideFloors(write, {
      runAudit: auditOf({picomatch: [picomatchRecord]}),
      readAccepted: acceptedOf(picomatchEntry, unused),
      now: at('2026-11-17'),
    })
    expect(clean).toBe(0)
    expect(written).toEqual([
      'check-override-floors: picomatch: advisory 1247710 (HIGH) accepted until 2026-12-17: Dev lint tooling only; no fixed version exists.\n',
      'check-override-floors: notice: old: accepted advisory 9 (GHSA-fc5q-39xc-vjpf) matches no reported advisory; remove its entry from accepted-advisories.json once the fix has landed\n',
    ])

    written.length = 0
    const failing = runCheckOverrideFloors(write, {
      runAudit: auditOf({picomatch: [picomatchRecord], other: [record({id: 4, severity: 'high'})]}),
      readAccepted: acceptedOf(picomatchEntry),
      now: at('2026-11-17'),
    })
    expect(failing).toBe(1)
    expect(written).toHaveLength(2)
    expect(written[0]).toMatch(/^check-override-floors: picomatch: advisory 1247710 \(HIGH\) accepted until/u)
    expect(written[1]).toMatch(/^check-override-floors: other: advisory 4 \(HIGH\)/u)
  })
})
