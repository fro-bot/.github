import type {AuditRunResult, RangeInterval} from './check-override-floors.ts'

import {mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  checkOverrideFloors,
  compareVersions,
  extractOverridesMap,
  isNoFixAvailable,
  overrideBaseName,
  overrideCoveredByPatched,
  parseAuditOutput,
  parseRangeGroups,
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

/** Parses `raw` into range groups and fails the test loudly if it doesn't parse. */
function mustParseGroups(raw: string): readonly RangeInterval[] {
  const result = parseRangeGroups(raw)
  if (!result.ok) throw new Error(`expected "${raw}" to parse as a range: ${result.reason}`)
  return result.groups
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

describe('parseRangeGroups', () => {
  it('parses a bare ">=X" range into a single unbounded-above interval', () => {
    expect(parseRangeGroups('>=4.1.3')).toEqual({
      ok: true,
      groups: [{lo: {major: 4, minor: 1, patch: 3, prerelease: []}, hi: undefined}],
    })
  })

  it('parses an exact pin as its own one-patch-wide interval, not an unbounded floor', () => {
    expect(parseRangeGroups('8.20.0')).toEqual({
      ok: true,
      groups: [
        {lo: {major: 8, minor: 20, patch: 0, prerelease: []}, hi: {major: 8, minor: 20, patch: 1, prerelease: []}},
      ],
    })
  })

  it('parses a compound ">=X <Y" range into one bounded interval, exclusive upper bound', () => {
    expect(parseRangeGroups('>=4.17.21 <5.0.0')).toEqual({
      ok: true,
      groups: [
        {
          lo: {major: 4, minor: 17, patch: 21, prerelease: []},
          hi: {major: 5, minor: 0, patch: 0, prerelease: []},
        },
      ],
    })
  })

  it('normalizes an inclusive ">=X <=Y" upper bound to an exclusive one at Y\'s next patch', () => {
    const [group] = mustParseGroups('>=1.0.0 <=2.0.0')
    expect(group?.hi).toEqual({major: 2, minor: 0, patch: 1, prerelease: []})
  })

  it('parses a disjoint (||) range into two independent intervals', () => {
    expect(parseRangeGroups('>=1.2.3 <2.0.0 || >=2.1.0')).toEqual({
      ok: true,
      groups: [
        {lo: {major: 1, minor: 2, patch: 3, prerelease: []}, hi: {major: 2, minor: 0, patch: 0, prerelease: []}},
        {lo: {major: 2, minor: 1, patch: 0, prerelease: []}, hi: undefined},
      ],
    })
  })

  it('treats a ">" lower bound as exclusive, using the next patch as its effective floor', () => {
    const [group] = mustParseGroups('>3.3.17')
    expect(group?.lo).toEqual({major: 3, minor: 3, patch: 18, prerelease: []})
  })

  it('fails closed with no lower bound at all', () => {
    expect(parseRangeGroups('<4').ok).toBe(false)
  })

  it('fails closed with more than one lower-bound comparator in the same group', () => {
    expect(parseRangeGroups('>=1.0.0 >=2.0.0').ok).toBe(false)
  })

  it('fails closed with more than one upper-bound comparator in the same group', () => {
    expect(parseRangeGroups('>=1.0.0 <2.0.0 <3.0.0').ok).toBe(false)
  })

  it('fails closed on an empty branch in a disjoint range', () => {
    expect(parseRangeGroups('>=1.0.0 || ').ok).toBe(false)
  })

  // Every genuinely uninterpretable shape this check has never claimed to support — on the
  // patched side.
  it.each(['^1.2.3', '~1.2', '*', 'garbage', ''])('fails closed on uninterpretable input %j', input => {
    expect(parseRangeGroups(input).ok).toBe(false)
  })
})

describe('overrideCoveredByPatched', () => {
  it('fails a floor sitting in the unpatched gap between two disjoint patched groups', () => {
    // The false negative from PR #3871's round-4 review: 2.0.0 clears the lowest lower bound
    // (1.2.3) but is not itself inside any patched interval — [2.0.0, 2.1.0) is the gap.
    const override = mustParseGroups('>=2.0.0')
    const patched = mustParseGroups('>=1.2.3 <2.0.0 || >=2.1.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(false)
  })

  it('passes a bounded floor fully inside the lower patched branch', () => {
    // Bounded, not unbounded: an unbounded '>=1.5.0' would admit the [2.0.0, 2.1.0) gap too and
    // must still fail (see the round-5 regression tests below) -- only a bounded override that
    // stays inside one branch is safe here.
    const override = mustParseGroups('>=1.5.0 <2.0.0')
    const patched = mustParseGroups('>=1.2.3 <2.0.0 || >=2.1.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(true)
  })

  it('passes a floor inside the upper (unbounded) patched branch', () => {
    const patched = mustParseGroups('>=1.2.3 <2.0.0 || >=2.1.0')
    expect(overrideCoveredByPatched(mustParseGroups('>=2.1.0'), patched)).toBe(true)
    expect(overrideCoveredByPatched(mustParseGroups('>=5.0.0'), patched)).toBe(true)
  })

  it('fails a floor below every branch', () => {
    const override = mustParseGroups('>=1.0.0')
    const patched = mustParseGroups('>=1.2.3 <2.0.0 || >=2.1.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(false)
  })

  it('excludes a bounded override reaching exactly an exclusive patched ceiling, one patch too far', () => {
    const patched = mustParseGroups('>=1.0.0 <2.0.0')
    expect(overrideCoveredByPatched(mustParseGroups('>=1.0.0 <2.0.1'), patched)).toBe(false)
    expect(overrideCoveredByPatched(mustParseGroups('>=1.0.0 <2.0.0'), patched)).toBe(true)
  })

  it('includes a bounded override reaching exactly an inclusive patched ceiling', () => {
    const patched = mustParseGroups('>=1.0.0 <=2.0.0')
    expect(overrideCoveredByPatched(mustParseGroups('>=1.0.0 <=2.0.0'), patched)).toBe(true)
  })

  it('collapses to simple at-or-above comparison for a single unbounded group', () => {
    const patched = mustParseGroups('>=4.1.3')
    expect(overrideCoveredByPatched(mustParseGroups('>=4.1.3'), patched)).toBe(true)
    expect(overrideCoveredByPatched(mustParseGroups('>=4.1.2'), patched)).toBe(false)
    expect(overrideCoveredByPatched(mustParseGroups('>=4.1.4'), patched)).toBe(true)
  })

  // The round-5 review's two mirrored false negatives: reducing the OVERRIDE side to a point
  // lost its own ceiling (or its own unboundedness), the same mistake made twice already on the
  // patched side.
  it('fails a bounded override with an unpatched tail above a bounded patched range', () => {
    const override = mustParseGroups('>=1.2.3 <5.0.0')
    const patched = mustParseGroups('>=1.2.3 <2.0.0')
    // Admits [2.0.0, 5.0.0), which the patched range never covers.
    expect(overrideCoveredByPatched(override, patched)).toBe(false)
  })

  it('fails an unbounded override against a patched range with a gap above its lower bound', () => {
    const override = mustParseGroups('>=4.17.21')
    const patched = mustParseGroups('>=4.17.21 <5.0.0 || >=5.0.3')
    // Admits [5.0.0, 5.0.3), the gap between the two patched branches, forever.
    expect(overrideCoveredByPatched(override, patched)).toBe(false)
  })

  it('passes an unbounded override against an unbounded patched group starting at or below it', () => {
    const override = mustParseGroups('>=5.0.0')
    const patched = mustParseGroups('>=4.17.21')
    expect(overrideCoveredByPatched(override, patched)).toBe(true)
  })

  it('passes a bounded override fully inside a single patched interval', () => {
    const override = mustParseGroups('>=1.5.0 <2.0.0')
    const patched = mustParseGroups('>=1.0.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(true)
  })

  it('passes a bounded override spanning two contiguous patched intervals with no gap', () => {
    const override = mustParseGroups('>=1.5.0 <2.5.0')
    const patched = mustParseGroups('>=1.2.3 <2.0.0 || >=2.0.0 <3.0.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(true)
  })

  it('fails a bounded override spanning a disjoint gap', () => {
    const override = mustParseGroups('>=1.5.0 <2.5.0')
    const patched = mustParseGroups('>=1.2.3 <2.0.0 || >=2.1.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(false)
  })

  it('excludes an exclusive override ceiling against an exclusive patched ceiling one below it', () => {
    // Override admits up to (not including) 2.0.0; patched covers only up to (not including) 2.0.0
    // as well -- exact match, covered.
    const override = mustParseGroups('>=1.0.0 <2.0.0')
    const patched = mustParseGroups('>=1.0.0 <2.0.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(true)
  })

  it('fails an inclusive override ceiling against an exclusive patched ceiling at the same version', () => {
    // Override admits 2.0.0 itself (<=2.0.0); patched excludes it (<2.0.0) -- not covered.
    const override = mustParseGroups('>=1.0.0 <=2.0.0')
    const patched = mustParseGroups('>=1.0.0 <2.0.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(false)
  })

  it('passes an exclusive override ceiling against an inclusive patched ceiling at the same version', () => {
    // Override admits up to (not including) 2.0.0; patched covers up to AND including 2.0.0 --
    // strictly more coverage than the override needs.
    const override = mustParseGroups('>=1.0.0 <2.0.0')
    const patched = mustParseGroups('>=1.0.0 <=2.0.0')
    expect(overrideCoveredByPatched(override, patched)).toBe(true)
  })
})

describe('isNoFixAvailable', () => {
  it('recognizes the npm advisory "<0.0.0" convention for no fix published', () => {
    expect(isNoFixAvailable('<0.0.0')).toBe(true)
  })

  it('does not misclassify an ordinary range as no-fix-available', () => {
    expect(isNoFixAvailable('>=4.1.3')).toBe(false)
    expect(isNoFixAvailable('<4.1.3')).toBe(false)
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
    expect(map.get('ajv')).toEqual([{key: 'ajv@8', raw: '8.20.0'}])
    expect(map.get('fast-uri')).toEqual([{key: 'fast-uri', raw: '>=4.1.3'}])
  })

  it('collects every selector-scoped entry for the same base package name, not just the last', () => {
    const map = extractOverridesMap(['overrides:', '  ajv@7: 7.0.0', '  ajv@8: 8.20.0'].join('\n'))
    expect(map.get('ajv')).toEqual([
      {key: 'ajv@7', raw: '7.0.0'},
      {key: 'ajv@8', raw: '8.20.0'},
    ])
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
        overrideKey: 'fast-uri',
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

  it('passes when a compound patched range has an already-compliant floor', async () => {
    const rootDir = await fixtureRoot("  lodash: '>=4.17.21'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'lodash', patched_versions: '>=4.17.21 <5.0.0'})]),
    })

    // Unbounded override against a bounded patched range with a gap above it: correctly a
    // failure now (see the round-5 fix), NOT the round-3 false positive this test originally
    // guarded against. Use the round-4/5 regression fixtures below for the "already covered"
    // shape of this case.
    expect(result.ok).toBe(false)
  })

  it('passes when a compound patched range fully covers the override (no gap above it)', async () => {
    const rootDir = await fixtureRoot("  lodash: '>=4.17.21 <5.0.0'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'lodash', patched_versions: '>=4.17.21 <5.0.0'})]),
    })

    expect(result).toEqual({ok: true, evaluated: 1, problems: []})
  })

  it("fails a floor sitting inside a disjoint patched range's vulnerable gap", async () => {
    const rootDir = await fixtureRoot("  widget: '>=2.0.0'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'widget', patched_versions: '>=1.2.3 <2.0.0 || >=2.1.0'})]),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'floor-below-patched',
        packageName: 'widget',
        overrideKey: 'widget',
        severity: 'high',
        advisoryId: 1000000,
        floor: '>=2.0.0',
        patchedVersions: '>=1.2.3 <2.0.0 || >=2.1.0',
      },
    ])
  })

  it('passes a bounded floor fully inside the lower branch of a disjoint patched range', async () => {
    // Bounded, not unbounded -- an unbounded '>=1.5.0' would admit the gap too (see the
    // dedicated round-5 regression tests below).
    const rootDir = await fixtureRoot("  widget: '>=1.5.0 <2.0.0'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'widget', patched_versions: '>=1.2.3 <2.0.0 || >=2.1.0'})]),
    })

    expect(result).toEqual({ok: true, evaluated: 1, problems: []})
  })

  it('passes a floor inside the upper branch of a disjoint patched range', async () => {
    const rootDir = await fixtureRoot("  widget: '>=2.1.0'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'widget', patched_versions: '>=1.2.3 <2.0.0 || >=2.1.0'})]),
    })

    expect(result).toEqual({ok: true, evaluated: 1, problems: []})
  })

  it('fails a floor below every branch of a disjoint patched range', async () => {
    const rootDir = await fixtureRoot("  widget: '>=1.0.0'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'widget', patched_versions: '>=1.2.3 <2.0.0 || >=2.1.0'})]),
    })

    expect(result.ok).toBe(false)
  })

  // The round-5 review's exact live-reproduced cases, at the checkOverrideFloors level.
  it('fails a bounded override with an unpatched tail above a bounded patched range (live case 1)', async () => {
    const rootDir = await fixtureRoot("  widget: '>=1.2.3 <5.0.0'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'widget', patched_versions: '>=1.2.3 <2.0.0'})]),
    })

    expect(result.ok).toBe(false)
  })

  it('fails an unbounded override against a disjoint patched range with a gap above it (live case 2)', async () => {
    const rootDir = await fixtureRoot("  lodash: '>=4.17.21'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'lodash', patched_versions: '>=4.17.21 <5.0.0 || >=5.0.3'})]),
    })

    expect(result.ok).toBe(false)
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

  it('classifies "<0.0.0" as no-fix-available, with its own message, and fails the gate', async () => {
    const rootDir = await fixtureRoot("  vulnerable-pkg: '>=1.0.0'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'vulnerable-pkg', patched_versions: '<0.0.0'})]),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'no-fix-available',
        packageName: 'vulnerable-pkg',
        severity: 'high',
        advisoryId: 1000000,
        patchedVersions: '<0.0.0',
      },
    ])
  })

  it('checks every selector-scoped override entry independently, catching a vulnerable @7 floor beside a safe @8 one', async () => {
    const rootDir = await fixtureRoot(['  ajv@7: 7.0.0', '  ajv@8: 8.20.0'].join('\n'))
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'ajv', patched_versions: '>=7.0.5'})]),
    })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        kind: 'floor-below-patched',
        packageName: 'ajv',
        overrideKey: 'ajv@7',
        severity: 'high',
        advisoryId: 1000000,
        floor: '7.0.0',
        patchedVersions: '>=7.0.5',
      },
    ])
  })

  it('passes a ">" lower bound against an inclusive patched floor one patch above it', async () => {
    const rootDir = await fixtureRoot("  widget: '>3.3.17'")
    const result = await checkOverrideFloors({
      rootDir,
      runAudit: auditOf([advisory({module_name: 'widget', patched_versions: '>=3.3.18'})]),
    })

    expect(result).toEqual({ok: true, evaluated: 1, problems: []})
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

  it.each(['^1.2.3', '~1.2', '*', 'garbage', ''])(
    'fails closed when patched_versions is genuinely uninterpretable (%j)',
    async patchedVersions => {
      const rootDir = await fixtureRoot("  fast-uri: '>=4.1.3'")
      const result = await checkOverrideFloors({
        rootDir,
        runAudit: auditOf([advisory({patched_versions: patchedVersions})]),
      })

      expect(result.ok).toBe(false)
      expect(result.problems[0]?.kind).toBe('unparseable-patched-range')
    },
  )

  it.each(['^1.2.3', '~1.2', '*', 'garbage', ''])(
    'fails closed when an override entry is genuinely uninterpretable (%j)',
    async overrideRaw => {
      const rootDir = await fixtureRoot(`  fast-uri: '${overrideRaw}'`)
      const result = await checkOverrideFloors({rootDir, runAudit: auditOf([advisory()])})

      expect(result.ok).toBe(false)
      expect(result.problems[0]?.kind).toBe('unparseable-override')
    },
  )

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
