/**
 * Drift guard for the local interim around bfra-me/.github#2767: the
 * update-repository-settings action's deepMerge assigns arrays wholesale, so
 * `.github/settings.yml`'s local `labels:` replaces (rather than extends)
 * `common-settings.yaml`'s base set instead of merging with it. Until that's
 * fixed upstream, `.github/settings.yml` inlines the full union by hand, and
 * this test keeps the two in sync.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
import {REQUIRED_LABELS} from './status-truth-proposals.ts'

interface Label {
  name: string
  color: string
  description?: string
}

function assertLabelsShape(value: unknown, filename: string): asserts value is {labels: Label[]} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('labels' in value) ||
    !Array.isArray((value as Record<string, unknown>).labels)
  ) {
    throw new TypeError(`${filename} does not have expected labels array`)
  }
}

const commonSettingsPath = resolve(import.meta.dirname, '../common-settings.yaml')
const commonSettingsParsed: unknown = parse(readFileSync(commonSettingsPath, 'utf8'))
assertLabelsShape(commonSettingsParsed, 'common-settings.yaml')
const baseLabels = commonSettingsParsed.labels

const repoSettingsPath = resolve(import.meta.dirname, '../.github/settings.yml')
const repoSettingsParsed: unknown = parse(readFileSync(repoSettingsPath, 'utf8'))
assertLabelsShape(repoSettingsParsed, '.github/settings.yml')
const repoLabelsByName = new Map(repoSettingsParsed.labels.map(label => [label.name, label]))

describe('.github/settings.yml labels: union with common-settings.yaml (interim for bfra-me/.github#2767)', () => {
  it('parses a non-empty base label list from common-settings.yaml (guards against a silent parse regression)', () => {
    expect(baseLabels.length).toBeGreaterThan(0)
  })

  it('has no duplicate label names in .github/settings.yml, compared case-insensitively (the settings plugin keys labels by name.toLowerCase())', () => {
    const seen = new Map<string, string[]>()
    for (const label of repoSettingsParsed.labels) {
      const key = label.name.toLowerCase()
      const names = seen.get(key) ?? []
      names.push(label.name)
      seen.set(key, names)
    }

    const duplicates = [...seen.values()].filter(names => names.length > 1).map(names => `"${names.join('", "')}"`)

    expect(duplicates).toEqual([])
  })

  // This only checks common-settings.yaml is a subset of .github/settings.yml; a label removed from the base leaves a stale copy here that must be removed by hand.
  it('carries every common-settings.yaml label into .github/settings.yml with an identical color and description', () => {
    const mismatches: string[] = []

    for (const baseLabel of baseLabels) {
      const repoLabel = repoLabelsByName.get(baseLabel.name)
      if (!repoLabel) {
        mismatches.push(`"${baseLabel.name}": missing from .github/settings.yml`)
        continue
      }
      if (repoLabel.color !== baseLabel.color) {
        mismatches.push(
          `"${baseLabel.name}": color mismatch (common-settings.yaml=${baseLabel.color}, settings.yml=${repoLabel.color})`,
        )
      }
      if (repoLabel.description !== baseLabel.description) {
        mismatches.push(
          `"${baseLabel.name}": description mismatch (common-settings.yaml="${baseLabel.description}", settings.yml="${repoLabel.description}")`,
        )
      }
    }

    expect(mismatches).toEqual([])
  })

  it('keeps the status-truth REQUIRED_LABELS descriptors in sync with .github/settings.yml', () => {
    const mismatches: string[] = []

    for (const requiredLabel of REQUIRED_LABELS) {
      const repoLabel = repoLabelsByName.get(requiredLabel.name)
      if (!repoLabel) {
        mismatches.push(`"${requiredLabel.name}": missing from .github/settings.yml`)
        continue
      }
      if (repoLabel.color.replace(/^#/, '').toLowerCase() !== requiredLabel.color.toLowerCase()) {
        mismatches.push(
          `"${requiredLabel.name}": color mismatch (REQUIRED_LABELS=${requiredLabel.color}, settings.yml=${repoLabel.color})`,
        )
      }
      if (repoLabel.description !== requiredLabel.description) {
        mismatches.push(
          `"${requiredLabel.name}": description mismatch (REQUIRED_LABELS="${requiredLabel.description}", settings.yml="${repoLabel.description}")`,
        )
      }
    }

    expect(mismatches).toEqual([])
  })
})
