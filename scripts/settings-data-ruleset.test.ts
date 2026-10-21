/**
 * Guards `.github/settings.yml`'s `data`-branch rulesets. The bfra-me/.github
 * `update-repository-settings` action's `rulesets` plugin (pinned v4.42.0, `22ed95a3`)
 * passes each entry's fields straight through to the Repository Rulesets REST API,
 * matches entries by `name` (case-insensitively), and deletes any ruleset it doesn't find
 * declared here — so a typo or a dropped rule silently weakens or removes enforcement on
 * the next settings run. This test pins the declared shapes so drift fails CI instead of
 * fro-bot's `data` branch.
 *
 * `common-settings.yaml` has no `rulesets` key, and `mergeConfigs` in the action's
 * `config.ts` only special-cases `labels`/`branches` for by-name `_extends` merging — every
 * other top-level key (including `rulesets`) is a plain `deepMerge`, so a local `rulesets:`
 * array is simply added, never silently replaced or merged away.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const FRO_BOT_APP_ID = 218644
const FRO_BOT_BOT_USER_ID = 109_017_866

interface RulesetCondition {
  ref_name?: {include?: unknown[]; exclude?: unknown[]}
}

interface RulesetRule {
  type: string
  [key: string]: unknown
}

interface BypassActor {
  actor_id?: number
  actor_type?: string
  bypass_mode?: string
}

interface Ruleset {
  name: string
  target?: string
  enforcement?: string
  conditions?: RulesetCondition
  rules?: RulesetRule[]
  bypass_actors?: BypassActor[]
  [key: string]: unknown
}

function assertRulesetsShape(value: unknown, filename: string): asserts value is {rulesets?: Ruleset[]} {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${filename} does not parse to an object`)
  }
}

const repoSettingsPath = resolve(import.meta.dirname, '../.github/settings.yml')
const repoSettingsParsed: unknown = parse(readFileSync(repoSettingsPath, 'utf8'))
assertRulesetsShape(repoSettingsParsed, '.github/settings.yml')

const commonSettingsPath = resolve(import.meta.dirname, '../common-settings.yaml')
const commonSettingsParsed: unknown = parse(readFileSync(commonSettingsPath, 'utf8'))
assertRulesetsShape(commonSettingsParsed, 'common-settings.yaml')

const rulesets = repoSettingsParsed.rulesets ?? []

const APP_RULESET_NAME = 'data branch: Fro Bot App only'
const DELETION_RULESET_NAME = 'data branch: no deletion'

function targetsDataBranch(ruleset: Ruleset): boolean {
  const refName = ruleset.conditions?.ref_name
  return refName?.include?.length === 1 && refName.include[0] === 'refs/heads/data' && refName.exclude?.length === 0
}

const dataRulesets = rulesets.filter(targetsDataBranch)

function rulesetNamed(name: string): Ruleset | undefined {
  return rulesets.find(ruleset => ruleset.name === name)
}

const appRuleset = rulesetNamed(APP_RULESET_NAME)
const deletionRuleset = rulesetNamed(DELETION_RULESET_NAME)

describe('.github/settings.yml rulesets: data branch is App-only and cannot be deleted', () => {
  it('common-settings.yaml declares no rulesets (a base array would not merge away a local one, but there is none to worry about)', () => {
    expect(commonSettingsParsed.rulesets).toBeUndefined()
  })

  it('has exactly two rulesets targeting refs/heads/data, and both are active branch rulesets', () => {
    expect(dataRulesets).toHaveLength(2)
    expect(dataRulesets.map(ruleset => ruleset.name).sort()).toEqual([APP_RULESET_NAME, DELETION_RULESET_NAME].sort())
    for (const ruleset of dataRulesets) {
      expect(ruleset.target).toBe('branch')
      expect(ruleset.enforcement).toBe('active')
      expect(ruleset.conditions?.ref_name).toEqual({include: ['refs/heads/data'], exclude: []})
    }
  })

  it('does not treat a ruleset that excludes refs/heads/data as targeting the data branch', () => {
    expect(
      targetsDataBranch({
        name: 'malformed data ruleset',
        conditions: {ref_name: {include: ['refs/heads/data'], exclude: ['refs/heads/data']}},
      }),
    ).toBe(false)
  })

  describe(`the "${APP_RULESET_NAME}" ruleset`, () => {
    it('exists', () => {
      expect(appRuleset).toBeDefined()
    })

    it('declares exactly the {update, non_fast_forward, creation} rule types, and no `deletion` rule', () => {
      const ruleTypes = (appRuleset?.rules ?? []).map(rule => rule.type).sort()
      expect(ruleTypes).toEqual(['creation', 'non_fast_forward', 'update'])
      expect(
        ruleTypes,
        'a `deletion` rule here would be covered by the Fro Bot App bypass; deletion is blocked by its own ruleset',
      ).not.toContain('deletion')
    })

    it('has exactly one bypass actor: the Fro Bot App (Integration, bypass_mode always, actor_id 218644)', () => {
      const bypassActors = appRuleset?.bypass_actors ?? []
      expect(bypassActors).toHaveLength(1)
      expect(bypassActors[0]?.actor_type).toBe('Integration')
      expect(bypassActors[0]?.bypass_mode).toBe('always')
      expect(bypassActors[0]?.actor_id).toBe(FRO_BOT_APP_ID)
      expect(bypassActors[0]?.actor_id).not.toBe(FRO_BOT_BOT_USER_ID)
    })

    it('has no RepositoryRole, User, Team, OrganizationAdmin, or DeployKey bypass actor', () => {
      const bypassActorTypes = (appRuleset?.bypass_actors ?? []).map(actor => actor.actor_type)
      const disallowedTypes = ['RepositoryRole', 'User', 'Team', 'OrganizationAdmin', 'DeployKey']
      for (const disallowed of disallowedTypes) {
        expect(
          bypassActorTypes,
          `bypass actor type "${disallowed}" is not allowed on the data branch ruleset`,
        ).not.toContain(disallowed)
      }
    })
  })

  describe(`the "${DELETION_RULESET_NAME}" ruleset`, () => {
    it('exists', () => {
      expect(deletionRuleset).toBeDefined()
    })

    it('declares exactly the `deletion` rule', () => {
      expect((deletionRuleset?.rules ?? []).map(rule => rule.type)).toEqual(['deletion'])
    })

    it('declares an explicit, empty `bypass_actors` array: nobody, not even the App, may delete `data`', () => {
      // No `?? []` fallback: an omitted key must fail here, because the plugin passes the field
      // through and an absent key is not the same declaration as an empty list.
      expect(deletionRuleset).toHaveProperty('bypass_actors')
      expect(Array.isArray(deletionRuleset?.bypass_actors)).toBe(true)
      expect(deletionRuleset?.bypass_actors).toEqual([])
    })
  })

  it('has no ruleset on `data` that carries both a `deletion` rule and a bypass actor', () => {
    for (const ruleset of dataRulesets) {
      const hasDeletion = (ruleset.rules ?? []).some(rule => rule.type === 'deletion')
      const hasBypass = (ruleset.bypass_actors ?? []).length > 0
      expect(hasDeletion && hasBypass, `ruleset "${ruleset.name}" lets an actor bypass the deletion rule`).toBe(false)
    }
  })
})
