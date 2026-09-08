import type {AuditRunResult} from './check-override-floors.ts'

import {mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  checkOverrideFloors,
  compareVersions,
  extractOverridesMap,
  overrideBaseName,
  parseAuditOutput,
  parseOverrideFloor,
  parsePatchedFloor,
  parseVersion,
} from './check-override-floors.ts'

async function fixtureRoot(overridesYaml: string): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'check-override-floors-'))
  await writeFile(
    join(rootDir, 'pnpm-workspace.yaml'),
    ['packages:', "  - 'packages/*'", '', 'overrides:', overridesYaml].join('\n'),
  )
  return rootDir
}

function advisory(
  overrides: Partial<{id: unknown; module_name: unknown; severity: unknown; patched_versions: unknown}> = {},
): unknown {
  return {
    id: 1000000,
    module_name: 'fast-uri',
    severity: 'high',
    patched_versions: '>=4.1.3',
    vulnerable_versions: '<4.1.3',
    ...overrides,
  }
}

function auditOf(advisories: readonly unknown[]): () => AuditRunResult {
  return () => ({ok: true, advisoryRecords: advisories})
}

/** Parses `raw` and fails the test loudly (rather than asserting away `undefined`) if it isn't valid semver. */
function mustParse(raw: string): ReturnType<typeof parseVersion> & object {
  const parsed = parseVersion(raw)
  if (!parsed) throw new Error(`expected "${raw}" to parse as a semver version`)
  return parsed
}

describe('parseVersion / compareVersions', () => {
  it('parses full major.minor.patch versions', () => {
    expect(parseVersion('4.1.3')).toEqual({major: 4, minor: 1, patch: 3, prerelease: []})
  })

  it('defaults missing minor/patch components to 0', () => {
    expect(parseVersion('4')).toEqual({major: 4, minor: 0, patch: 0, prerelease: []})
  })

  it('parses a prerelease suffix', () => {
    expect(parseVersion('4.1.3-beta.1')).toEqual({major: 4, minor: 1, patch: 3, prerelease: ['beta', '1']})
  })

  it('returns undefined for non-semver input', () => {
    expect(parseVersion('not-a-version')).toBeUndefined()
  })

  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(mustParse('4.1.2'), mustParse('4.1.3'))).toBe(-1)
    expect(compareVersions(mustParse('4.1.3'), mustParse('4.1.2'))).toBe(1)
    expect(compareVersions(mustParse('4.1.3'), mustParse('4.1.3'))).toBe(0)
  })

  it('ranks a release above its own prerelease', () => {
    expect(compareVersions(mustParse('4.1.3-beta.1'), mustParse('4.1.3'))).toBe(-1)
  })
})

describe('parsePatchedFloor', () => {
  it('accepts a bare ">=X" floor', () => {
    expect(parsePatchedFloor('>=4.1.3')).toEqual({ok: true, version: {major: 4, minor: 1, patch: 3, prerelease: []}})
  })

  it('fails closed on a disjoint (||) range', () => {
    const result = parsePatchedFloor('>=1.0.0 <2.0.0 || >=3.0.0')
    expect(result.ok).toBe(false)
  })

  it('fails closed on a compound range', () => {
    expect(parsePatchedFloor('>=1.0.0 <2.0.0').ok).toBe(false)
  })

  it('fails closed on an operator other than ">="', () => {
    expect(parsePatchedFloor('<4.1.3').ok).toBe(false)
  })

  it('fails closed on unparseable version text', () => {
    expect(parsePatchedFloor('>=not-a-version').ok).toBe(false)
  })
})

describe('parseOverrideFloor', () => {
  it('accepts a bare ">=X" floor', () => {
    expect(parseOverrideFloor('>=5.0.9').ok).toBe(true)
  })

  it('accepts an exact pin as a floor', () => {
    const result = parseOverrideFloor('8.20.0')
    expect(result).toEqual({ok: true, version: {major: 8, minor: 20, patch: 0, prerelease: []}})
  })

  it('accepts a bounded ">=X <Y" range, using the lower bound as the floor', () => {
    const result = parseOverrideFloor('>=3.3.18 <4')
    expect(result).toEqual({ok: true, version: {major: 3, minor: 3, patch: 18, prerelease: []}})
  })

  it('fails closed with no lower bound at all', () => {
    expect(parseOverrideFloor('<4').ok).toBe(false)
  })

  it('fails closed with more than one lower-bound comparator', () => {
    expect(parseOverrideFloor('>=1.0.0 >=2.0.0').ok).toBe(false)
  })

  it('fails closed on a disjoint (||) range', () => {
    expect(parseOverrideFloor('>=1.0.0 || >=2.0.0').ok).toBe(false)
  })
})

describe('overrideBaseName', () => {
  it('passes through a plain package name unchanged', () => {
    expect(overrideBaseName('fast-uri')).toBe('fast-uri')
  })

  it('strips a version selector suffix', () => {
    expect(overrideBaseName('ajv@8')).toBe('ajv')
  })

  it('strips a version selector suffix from a scoped package', () => {
    expect(overrideBaseName('@scope/pkg@1')).toBe('@scope/pkg')
  })
})

describe('extractOverridesMap', () => {
  it('maps override keys to their raw floor strings, keyed by base package name', () => {
    const map = extractOverridesMap(['overrides:', '  ajv@8: 8.20.0', "  fast-uri: '>=4.1.3'"].join('\n'))
    expect(map.get('ajv')).toBe('8.20.0')
    expect(map.get('fast-uri')).toBe('>=4.1.3')
  })

  it('returns an empty map when there is no overrides section', () => {
    expect(extractOverridesMap('packages:\n  - "packages/*"\n').size).toBe(0)
  })
})

describe('parseAuditOutput', () => {
  it('fails closed on output that is not valid JSON', () => {
    expect(parseAuditOutput('not json').ok).toBe(false)
  })

  it('fails closed when metadata.vulnerabilities is missing', () => {
    expect(parseAuditOutput(JSON.stringify({advisories: {}})).ok).toBe(false)
  })

  it('fails closed when advisories is missing', () => {
    expect(parseAuditOutput(JSON.stringify({metadata: {vulnerabilities: {}}})).ok).toBe(false)
  })

  it('succeeds on well-shaped output, extracting advisory records', () => {
    const result = parseAuditOutput(
      JSON.stringify({metadata: {vulnerabilities: {high: 1}}, advisories: {a: advisory()}}),
    )
    expect(result).toEqual({ok: true, advisoryRecords: [advisory()]})
  })
})

describe('checkOverrideFloors', () => {
  it('fails when an override floor sits below the patched range', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.2'")
    const result = await checkOverrideFloors({rootDir, runAudit: auditOf([advisory()])})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'floor-below-patched',
        packageName: 'fast-uri',
        severity: 'high',
        advisoryId: 1000000,
        floor: '>=4.1.2',
        patchedVersions: '>=4.1.3',
      },
    ])
  })

  it('passes when the override floor is at the patched version', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.3'")
    const result = await checkOverrideFloors({rootDir, runAudit: auditOf([advisory()])})

    expect(result).toEqual({ok: true, evaluated: 1, problems: []})
  })

  it('passes when the override floor is above the patched version', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.4'")
    const result = await checkOverrideFloors({rootDir, runAudit: auditOf([advisory()])})

    expect(result.ok).toBe(true)
  })

  it('fails when a vulnerable package has no override entry at all', async () => {
    const rootDir = await fixtureRoot("  flatted: '>=3.4.2'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'nanoid', patched_versions: '>=3.3.18'})]),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'missing-override',
        packageName: 'nanoid',
        severity: 'high',
        advisoryId: 1000000,
        patchedVersions: '>=3.3.18',
      },
    ])
  })

  it('fails when pnpm audit output does not parse', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.3'")
    const result = await checkOverrideFloors({rootDir, runAudit: () => ({ok: false, reason: 'boom'})})

    expect(result).toEqual({ok: false, evaluated: 0, problems: [], auditFailure: 'boom'})
  })

  it('fails when a non-zero pnpm audit exit is not attributable to findings (no parseable stdout)', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.3'")
    // Simulates runPnpmAudit's own handling of a spawn failure (e.g. ENOENT): no captured
    // stdout at all, so there is nothing to interpret as findings.
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: () => ({ok: false, reason: 'pnpm audit could not be executed: spawn pnpm ENOENT'}),
    })

    expect(result.ok).toBe(false)
    expect(result.auditFailure).toMatch(/ENOENT/)
  })

  it('does not evaluate or fail on an advisory below the severity threshold', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.2'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({severity: 'moderate'})]),
    })

    expect(result).toEqual({ok: true, evaluated: 0, problems: []})
  })

  it('evaluates a moderate advisory when the threshold is lowered explicitly', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.2'")
    const result = await checkOverrideFloors({
      rootDir,
      severityThreshold: 'moderate',
      runAudit: auditOf([advisory({severity: 'moderate'})]),
    })

    expect(result.ok).toBe(false)
    expect(result.evaluated).toBe(1)
  })

  it('fails closed on an advisory record missing required fields', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.3'")
    const result = await checkOverrideFloors({rootDir, runAudit: auditOf([{module_name: 'fast-uri'}])})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([{kind: 'unparseable-advisory-record', index: 0}])
  })

  it('fails closed on an advisory with an unrecognized severity string', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.3'")
    const result = await checkOverrideFloors({rootDir, runAudit: auditOf([advisory({severity: 'catastrophic'})])})

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {kind: 'unrecognized-severity', packageName: 'fast-uri', advisoryId: 1000000, severity: 'catastrophic'},
    ])
  })

  it('fails closed on a patched_versions range this check cannot interpret', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=4.1.3'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({patched_versions: '>=1.0.0 <2.0.0 || >=3.0.0'})]),
    })

    expect(result.ok).toBe(false)
    expect(result.problems[0]?.kind).toBe('unparseable-patched-range')
  })

  it('fails closed on an override entry this check cannot interpret', async () => {
    const rootDir = await fixtureRoot("  fast-uri: '>=1.0.0 || >=4.1.3'")
    const result = await checkOverrideFloors({rootDir, runAudit: auditOf([advisory()])})

    expect(result.ok).toBe(false)
    expect(result.problems[0]?.kind).toBe('unparseable-override')
  })

  // Regression: reproduces PR #3871's own three packages at their pre-fix floors — the exact
  // shape of defect this gate exists to catch (see the module docstring).
  it('names all three packages from PR #3871 at their pre-fix floors', async () => {
    const rootDir = await fixtureRoot(["  brace-expansion: '>=5.0.8'", "  fast-uri: '>=4.1.2'"].join('\n'))
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([
        advisory({id: 1130734, module_name: 'brace-expansion', patched_versions: '>=5.0.9'}),
        advisory({id: 1139427, module_name: 'nanoid', patched_versions: '>=3.3.18'}),
        advisory({id: 1000000, module_name: 'fast-uri', patched_versions: '>=4.1.3'}),
      ]),
    })

    expect(result.ok).toBe(false)
    const packageNames = result.problems
      .map(problem => ('packageName' in problem ? problem.packageName : undefined))
      .toSorted((a, b) => String(a).localeCompare(String(b)))
    expect(packageNames).toEqual(['brace-expansion', 'fast-uri', 'nanoid'])
  })

  it('passes when all three packages from PR #3871 are at their fixed floors', async () => {
    const rootDir = await fixtureRoot(
      ["  brace-expansion: '>=5.0.9'", "  fast-uri: '>=4.1.3'", "  nanoid: '>=3.3.18 <4'"].join('\n'),
    )
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([
        advisory({id: 1130734, module_name: 'brace-expansion', patched_versions: '>=5.0.9'}),
        advisory({id: 1139427, module_name: 'nanoid', patched_versions: '>=3.3.18'}),
        advisory({id: 1000000, module_name: 'fast-uri', patched_versions: '>=4.1.3'}),
      ]),
    })

    expect(result).toEqual({ok: true, evaluated: 3, problems: []})
  })
})
