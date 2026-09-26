/**
 * Guards `.github/settings.yml`'s `data`-branch ruleset. The bfra-me/.github
 * `update-repository-settings` action's `rulesets` plugin (pinned v4.33.0, `6f33c678`)
 * passes each entry's fields straight through to the Repository Rulesets REST API,
 * matches entries by `name` (case-insensitively), and deletes any ruleset it doesn't find
 * declared here — so a typo or a dropped rule silently weakens or removes enforcement on
 * the next settings run. This test pins the declared shape so drift fails CI instead of
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
const dataRulesets = rulesets.filter(ruleset => ruleset.conditions?.ref_name?.include?.includes('refs/heads/data'))

describe('.github/settings.yml rulesets: data branch is App-only', () => {
  it('common-settings.yaml declares no rulesets (a base array would not merge away a local one, but there is none to worry about)', () => {
    expect(commonSettingsParsed.rulesets).toBeUndefined()
  })

  it('has exactly one ruleset targeting refs/heads/data, and it is active', () => {
    expect(dataRulesets).toHaveLength(1)
    expect(dataRulesets[0]?.target).toBe('branch')
    expect(dataRulesets[0]?.enforcement).toBe('active')
  })

  it('declares exactly the {update, non_fast_forward, creation} rule types', () => {
    const dataRuleset = dataRulesets[0]
    const ruleTypes = (dataRuleset?.rules ?? []).map(rule => rule.type).sort()
    expect(ruleTypes).toEqual(['creation', 'non_fast_forward', 'update'])
  })

  it('has no `deletion` rule (promotion relies on auto-delete-on-merge + the App reseeding `data` from `main`)', () => {
    const dataRuleset = dataRulesets[0]
    const ruleTypes = (dataRuleset?.rules ?? []).map(rule => rule.type)
    expect(
      ruleTypes,
      'a `deletion` rule would block the auto-delete-on-merge + App-reseed promotion cycle documented in .github/settings.yml',
    ).not.toContain('deletion')
  })

  it('has exactly one bypass actor: the Fro Bot App (Integration, bypass_mode always, actor_id 218644)', () => {
    const dataRuleset = dataRulesets[0]
    const bypassActors = dataRuleset?.bypass_actors ?? []
    expect(bypassActors).toHaveLength(1)
    expect(bypassActors[0]?.actor_type).toBe('Integration')
    expect(bypassActors[0]?.bypass_mode).toBe('always')
    expect(bypassActors[0]?.actor_id).toBe(FRO_BOT_APP_ID)
    expect(bypassActors[0]?.actor_id).not.toBe(FRO_BOT_BOT_USER_ID)
  })

  it('has no RepositoryRole, User, Team, OrganizationAdmin, or DeployKey bypass actor', () => {
    const dataRuleset = dataRulesets[0]
    const bypassActorTypes = (dataRuleset?.bypass_actors ?? []).map(actor => actor.actor_type)
    const disallowedTypes = ['RepositoryRole', 'User', 'Team', 'OrganizationAdmin', 'DeployKey']
    for (const disallowed of disallowedTypes) {
      expect(
        bypassActorTypes,
        `bypass actor type "${disallowed}" is not allowed on the data branch ruleset`,
      ).not.toContain(disallowed)
    }
  })
})
