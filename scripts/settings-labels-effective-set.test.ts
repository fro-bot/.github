/**
 * Guards `.github/settings.yml`'s labels against the pre-v4.32.0 workaround
 * regrowing: bfra-me/.github's update-repository-settings action now merges
 * `_extends` labels with the child's by name (case-insensitively, child
 * entry wins whole), so `.github/settings.yml` should only declare
 * control-plane labels that either aren't in common-settings.yaml or
 * intentionally diverge from it. This test keeps that contract honest.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
import {LEARNING_PROPOSAL_LABEL_DESCRIPTOR} from './capture-learnings-open.ts'
import {PATTERN_PROPOSAL_REQUIRED_LABELS} from './capture-patterns-synthesis.ts'
import {TRANSITION_LABELS} from './reconcile-repos.ts'
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

/** Mirrors update-repository-settings' v4.32.0 `_extends` label merge: base and child merged by lowercase name, child entry replacing base entry whole. */
function computeEffectiveLabels(base: Label[], child: Label[]): Map<string, Label> {
  const effective = new Map<string, Label>()
  for (const label of base) {
    effective.set(label.name.toLowerCase(), label)
  }
  for (const label of child) {
    effective.set(label.name.toLowerCase(), label)
  }
  return effective
}

const commonSettingsPath = resolve(import.meta.dirname, '../common-settings.yaml')
const commonSettingsParsed: unknown = parse(readFileSync(commonSettingsPath, 'utf8'))
assertLabelsShape(commonSettingsParsed, 'common-settings.yaml')
const baseLabels = commonSettingsParsed.labels

const repoSettingsPath = resolve(import.meta.dirname, '../.github/settings.yml')
const repoSettingsParsed: unknown = parse(readFileSync(repoSettingsPath, 'utf8'))
assertLabelsShape(repoSettingsParsed, '.github/settings.yml')

const effectiveLabelsByName = computeEffectiveLabels(baseLabels, repoSettingsParsed.labels)

describe('.github/settings.yml labels: effective set after the v4.32.0 by-name _extends merge', () => {
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

  it('has no .github/settings.yml label that exactly duplicates a common-settings.yaml label (name, color, and description all identical)', () => {
    const redundant: string[] = []

    for (const repoLabel of repoSettingsParsed.labels) {
      const baseLabel = baseLabels.find(label => label.name.toLowerCase() === repoLabel.name.toLowerCase())
      if (
        baseLabel &&
        baseLabel.color === repoLabel.color &&
        (baseLabel.description ?? undefined) === (repoLabel.description ?? undefined)
      ) {
        redundant.push(`"${repoLabel.name}": identical to common-settings.yaml, remove from .github/settings.yml`)
      }
    }

    expect(redundant).toEqual([])
  })

  // Table-driven: add a fifth code-declared descriptor set by appending one entry here.
  const codeLabelSources: {
    source: string
    descriptors: readonly {name: string; color: string; description: string}[]
  }[] = [
    {source: 'REQUIRED_LABELS', descriptors: REQUIRED_LABELS},
    {source: 'PATTERN_PROPOSAL_REQUIRED_LABELS', descriptors: PATTERN_PROPOSAL_REQUIRED_LABELS},
    {source: 'TRANSITION_LABELS', descriptors: TRANSITION_LABELS},
    {source: 'LEARNING_PROPOSAL_LABEL_DESCRIPTOR', descriptors: [LEARNING_PROPOSAL_LABEL_DESCRIPTOR]},
  ]

  it('contributes at least one descriptor per source, totaling 16 (non-vacuity guard)', () => {
    for (const {source, descriptors} of codeLabelSources) {
      expect(descriptors.length, `"${source}": expected at least one descriptor`).toBeGreaterThan(0)
    }

    const total = codeLabelSources.reduce((sum, {descriptors}) => sum + descriptors.length, 0)
    expect(total, 'update this count when adding or removing a code-declared label').toBe(16)
  })

  it('keeps every code-declared label descriptor in sync with the effective merged label set (base + .github/settings.yml, merged by name)', () => {
    const mismatches: string[] = []

    for (const {source, descriptors} of codeLabelSources) {
      for (const requiredLabel of descriptors) {
        const repoLabel = effectiveLabelsByName.get(requiredLabel.name.toLowerCase())
        if (!repoLabel) {
          mismatches.push(`${source} "${requiredLabel.name}": missing from the effective merged label set`)
          continue
        }
        if (repoLabel.color.replace(/^#/, '').toLowerCase() !== requiredLabel.color.toLowerCase()) {
          mismatches.push(
            `${source} "${requiredLabel.name}": color mismatch (${source}=${requiredLabel.color}, effective=${repoLabel.color})`,
          )
        }
        if (repoLabel.description !== requiredLabel.description) {
          mismatches.push(
            `${source} "${requiredLabel.name}": description mismatch (${source}="${requiredLabel.description}", effective="${repoLabel.description}")`,
          )
        }
      }
    }

    expect(mismatches).toEqual([])
  })
})
