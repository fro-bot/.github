import type {AllowedVersionsEntry, RangeVerdict, VersioningEngine} from './check-renovate-ranges.ts'
import process from 'node:process'

import {describe, expect, it} from 'vitest'

import {
  checkAllowedVersion,
  checkRenovateRanges,
  collectAllowedVersions,
  formatRangeFinding,
  readConfigSources,
} from './check-renovate-ranges.ts'
import {loadRenovateRuntime, readPinnedVersion, resolvePrefix} from './renovate-runtime.ts'

/**
 * Stand-in for Renovate's versioning API, discriminating only as much as these tests need:
 * `npm` takes space/`||`-joined comparators and rejects commas, `pep440` takes comma-joined
 * specifiers, `docker` accepts no range at all. The semver fallback is raw `semver.validRange`: no
 * legacy `x` ranges (`1.x.5`), which only the npm versioning normalizes. Real semantics are covered
 * by the RENOVATE_PREFIX integration test below.
 */
const engine: VersioningEngine = {
  isKnownVersioning: spec => ['npm', 'pep440', 'docker', 'regex'].includes(spec.split(':')[0] ?? ''),
  hasRegexPredicate: value => {
    const match = /^!?\/(.*)\/i?$/.exec(value)
    if (match?.[1] === undefined) return false
    try {
      return new RegExp(match[1]) instanceof RegExp
    } catch {
      return false
    }
  },
  isValid: (spec, value) => {
    if (spec.startsWith('regex')) return /^[<>=\d. ]+$/.test(value)
    if (spec === 'npm') return /^[<>=^~\d.x*\s|-]+$/.test(value)
    if (spec === 'pep440') return /^[<>=~!\d.,\s]+$/.test(value)
    return false
  },
  isValidSemverRange: value => /^[<>=^~\d.*\s|-]+$/.test(value),
}

function entry(value: unknown, versioning?: string): AllowedVersionsEntry {
  return {source: 'fixture.json', location: '$.packageRules[0]', rule: '', value, versioning}
}

/** Returns the reason of an `invalid` verdict and fails loudly for any other kind. */
function invalidReason(verdict: RangeVerdict): string {
  if (verdict.kind !== 'invalid') throw new Error(`expected an invalid verdict, got ${verdict.kind}`)
  return verdict.reason
}

describe('collectAllowedVersions', () => {
  it('finds values in top-level and nested rules with their JSON path and rule identity', () => {
    const entries = collectAllowedVersions(
      {
        allowedVersions: '<2',
        packageRules: [
          {matchPackageNames: ['python'], allowedVersions: '<=3.13'},
          {description: ['First line wins.', 'Ignored.'], allowedVersions: String.raw`!/harness\./`},
          {packageRules: [{matchPackageNames: ['deep'], allowedVersions: '>=1'}]},
        ],
      },
      'default.json',
    )

    expect(entries.map(found => [found.location, found.value, found.rule])).toEqual([
      ['$', '<2', ''],
      ['$.packageRules[0]', '<=3.13', 'matchPackageNames: python'],
      ['$.packageRules[1]', String.raw`!/harness\./`, 'First line wins.'],
      ['$.packageRules[2].packageRules[0]', '>=1', 'matchPackageNames: deep'],
    ])
    expect(entries.every(found => found.source === 'default.json')).toBe(true)
  })

  it('inherits versioning from the nearest enclosing object and lets a rule override it', () => {
    const entries = collectAllowedVersions(
      {
        versioning: 'pep440',
        packageRules: [{allowedVersions: '>=3.10,<3.14'}, {versioning: 'docker', allowedVersions: '<3'}],
      },
      'x.json',
    )

    expect(entries.map(found => found.versioning)).toEqual(['pep440', 'docker'])
  })

  it('returns nothing for configs without the key, and for non-object input', () => {
    expect(collectAllowedVersions({packageRules: [{matchPackageNames: ['a'], enabled: false}]}, 'x')).toEqual([])
    expect(collectAllowedVersions('allowedVersions', 'x')).toEqual([])
    expect(collectAllowedVersions(null, 'x')).toEqual([])
  })
})

describe('checkAllowedVersion', () => {
  it('accepts a valid npm range when the rule declares no versioning', () => {
    expect(checkAllowedVersion(entry('<6.1.0'), engine)).toEqual({kind: 'valid', via: 'versioning'})
    expect(checkAllowedVersion(entry('<=3.13'), engine)).toEqual({kind: 'valid', via: 'versioning'})
    expect(checkAllowedVersion(entry('>=1.2.3 <2.0.0 || >=3'), engine)).toEqual({kind: 'valid', via: 'versioning'})
  })

  it('rejects a malformed range that the static validator lets through', () => {
    const verdict = checkAllowedVersion(entry('<=3.13 || not-a-range(('), engine)

    expect(invalidReason(verdict)).toContain('versioning="npm"')
  })

  it('accepts the regex form and its negation', () => {
    expect(checkAllowedVersion(entry(String.raw`/^1\./`), engine)).toEqual({kind: 'valid', via: 'regex'})
    expect(checkAllowedVersion(entry(String.raw`!/harness\./`), engine)).toEqual({kind: 'valid', via: 'regex'})
  })

  it('rejects a regex that Renovate cannot compile instead of passing it as a range', () => {
    expect(checkAllowedVersion(entry('/^(unclosed/'), engine).kind).toBe('invalid')
    expect(checkAllowedVersion(entry('!/^(unclosed/'), engine).kind).toBe('invalid')
  })

  it('judges a value with the rule versioning, not npm', () => {
    // Valid pep440 specifier syntax (comma-joined) that npm semver cannot parse.
    expect(checkAllowedVersion(entry('>=3.10,<3.14', 'pep440'), engine)).toEqual({kind: 'valid', via: 'versioning'})
    expect(checkAllowedVersion(entry('>=3.10,<3.14'), engine).kind).toBe('invalid')
  })

  it('rejects a value invalid for the declared non-npm versioning', () => {
    const verdict = checkAllowedVersion(entry('not-a-specifier', 'pep440'), engine)

    expect(invalidReason(verdict)).toContain('versioning="pep440"')
  })

  it('falls back to raw semver range syntax when the declared versioning cannot parse the value', () => {
    // Mirrors Renovate's "Falling back to npm semver syntax for allowedVersions" branch.
    expect(checkAllowedVersion(entry('<3.14', 'docker'), engine)).toEqual({kind: 'valid', via: 'semver-fallback'})
  })

  it('does not apply the npm versioning legacy-range normalization to the semver fallback', () => {
    expect(checkAllowedVersion(entry('1.x.5'), engine)).toEqual({kind: 'valid', via: 'versioning'})
    expect(invalidReason(checkAllowedVersion(entry('1.x.5', 'docker'), engine))).toContain('versioning="docker"')
  })

  it('rejects an unknown versioning rather than letting Renovate silently fall back to semver-coerced', () => {
    const verdict = checkAllowedVersion(entry('<1', 'definitely-not-a-versioning'), engine)

    expect(verdict).toEqual({kind: 'invalid', reason: 'unknown versioning "definitely-not-a-versioning"'})
  })

  it('accepts a parameterised versioning name', () => {
    expect(checkAllowedVersion(entry('<3', String.raw`regex:^(?<major>\d+)$`), engine).kind).toBe('valid')
  })

  it('rejects non-string values', () => {
    expect(checkAllowedVersion(entry(3.13), engine)).toEqual({kind: 'invalid', reason: 'must be a string, got number'})
    expect(checkAllowedVersion(entry(['<2']), engine)).toEqual({kind: 'invalid', reason: 'must be a string, got array'})
    expect(checkAllowedVersion(entry(null), engine)).toEqual({kind: 'invalid', reason: 'must be a string, got object'})
  })

  it('reports templated values as not statically checkable instead of passing them', () => {
    expect(checkAllowedVersion(entry('<{{major}}'), engine)).toEqual({kind: 'templated'})
  })
})

describe('checkRenovateRanges', () => {
  it('passes when every value is valid and counts what it checked', () => {
    const result = checkRenovateRanges(
      [
        {
          source: 'a.json',
          config: {packageRules: [{allowedVersions: '<=3.13'}, {allowedVersions: String.raw`!/harness\./`}]},
        },
        {source: 'b.json', config: {packageRules: [{allowedVersions: '<6.1.0'}]}},
      ],
      engine,
    )

    expect(result).toEqual({ok: true, checked: 3, problems: [], skipped: []})
  })

  it('fails and names the offending rule, file and value', () => {
    const result = checkRenovateRanges(
      [
        {source: 'ok.json', config: {packageRules: [{allowedVersions: '<2'}]}},
        {
          source: 'default.json',
          config: {packageRules: [{matchPackageNames: ['python'], allowedVersions: '<=3.13 || not-a-range(('}]},
        },
      ],
      engine,
    )

    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    const [problem] = result.problems
    if (problem === undefined) throw new Error('expected one problem')
    expect(formatRangeFinding(problem)).toBe(
      'default.json $.packageRules[0] (matchPackageNames: python): allowedVersions "<=3.13 || not-a-range((": ' +
        'does not parse as a valid version or range with versioning="npm"',
    )
  })

  it('does not fail on templated values but surfaces them as skipped', () => {
    const result = checkRenovateRanges([{source: 'a.json', config: {allowedVersions: '<{{major}}'}}], engine)

    expect(result.ok).toBe(true)
    expect(result.skipped).toHaveLength(1)
    expect(result.checked).toBe(1)
  })
})

describe('readConfigSources', () => {
  it('reads each path and hands its text to the injected parser', async () => {
    const files: Record<string, string> = {
      'a.json': '{"allowedVersions": "<1"}',
      'b.json5': '{"allowedVersions": "<2"}',
    }

    const sources = await readConfigSources(Object.keys(files), JSON.parse, async path => files[path] ?? '')

    expect(sources).toEqual([
      {source: 'a.json', config: {allowedVersions: '<1'}},
      {source: 'b.json5', config: {allowedVersions: '<2'}},
    ])
  })

  it('rejects when a file is not parseable, so a corrupt config cannot pass silently', async () => {
    await expect(readConfigSources(['bad.json'], JSON.parse, async () => '{not json')).rejects.toThrow()
  })
})

async function realEngine(): Promise<VersioningEngine> {
  const version = await readPinnedVersion(process.cwd())
  return (await loadRenovateRuntime(resolvePrefix(version), version)).versioning
}

// Real Renovate semantics. Runs only when RENOVATE_PREFIX points at an install of the pinned
// version (CI sets it for the `Check Workflows` job; see the `renovate-runtime` integration test).
describe.skipIf(process.env.RENOVATE_PREFIX === undefined)('against the pinned Renovate install', () => {
  it('accepts what Renovate accepts and rejects what it would throw on', async () => {
    const real = await realEngine()
    const verdicts = (value: string, versioning?: string) => checkAllowedVersion(entry(value, versioning), real).kind

    expect(verdicts('<6.1.0')).toBe('valid')
    expect(verdicts('<=3.13')).toBe('valid')
    expect(verdicts(String.raw`!/harness\./`)).toBe('valid')
    expect(verdicts('>=3.10,<3.14', 'pep440')).toBe('valid')
    expect(verdicts('<3.14', 'docker')).toBe('valid')
    expect(verdicts('<=3.13 || not-a-range((')).toBe('invalid')
    expect(verdicts('/^(unclosed/')).toBe('invalid')
    expect(verdicts('>=3.10,<3.14')).toBe('invalid')
    expect(verdicts('<1', 'definitely-not-a-versioning')).toBe('invalid')
    expect(verdicts('<3', String.raw`regex:^(?<major>\d+)$`)).toBe('valid')
  })

  it('rejects a regex RE2 cannot compile, which JavaScript RegExp would accept', async () => {
    const real = await realEngine()

    // Lookahead is valid JavaScript but RE2 has no such operator: with RE2 it is not a regex
    // predicate, so the value falls through and parses as neither a range nor a version.
    expect(real.hasRegexPredicate('/^(?!2)/')).toBe(false)
    expect(checkAllowedVersion(entry('/^(?!2)/'), real).kind).toBe('invalid')
    expect(checkAllowedVersion(entry('/^(?!2)/', 'docker'), real).kind).toBe('invalid')
    expect(checkAllowedVersion(entry(String.raw`/^(?:1|3)\./`), real).kind).toBe('valid')
  })

  it('applies the raw semver fallback, not the npm legacy-range normalization', async () => {
    const real = await realEngine()
    const verdicts = (value: string, versioning?: string) => checkAllowedVersion(entry(value, versioning), real).kind

    expect(real.isValidSemverRange('1.x.5')).toBe(false)
    expect(real.isValidSemverRange('<3.14')).toBe(true)
    expect(verdicts('1.x.5', 'docker')).toBe('invalid')
    // The npm versioning itself normalizes `1.x.5`, so a rule that selects npm (or none) still passes.
    expect(verdicts('1.x.5', 'npm')).toBe('valid')
    expect(verdicts('1.x.5')).toBe('valid')
  })
})
