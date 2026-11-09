import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  assessEvent,
  parseDeclaredProtection,
  planAction,
  renderReport,
  runProtectionDrift,
  type DeclaredProtection,
  type DriftEvent,
  type ProtectionDriftOctokit,
} from './protection-drift.ts'

const CONTEXTS = ['Lint', 'Test', 'Security: Private Leak Scan'] as const

const COMMON = `
branches:
  - name: main
    protection:
      required_status_checks:
        strict: true
        contexts: []
      enforce_admins: true
      required_pull_request_reviews:
        dismiss_stale_reviews: true
        require_code_owner_reviews: true
        required_approving_review_count: 1
        require_last_push_approval: true
`

const REPO = `
_extends: .github:common-settings.yaml
branches:
  - name: main
    protection:
      required_status_checks:
        strict: true
        contexts:
          - Lint
          - Test
          - 'Security: Private Leak Scan'
`

const DECLARED: DeclaredProtection = {
  reviewCount: 1,
  codeOwners: true,
  dismissStale: true,
  lastPush: true,
  strict: true,
  enforceAdmins: true,
  contexts: CONTEXTS,
}

const SETTINGS_ACTOR = {login: 'fro-bot[bot]', id: 109_017_866, type: 'Bot'}
const OPERATOR_USER = {login: 'fro-bot', id: 42, type: 'User'}

/** A `branch_protection_rule` rule as GitHub sends it for the declared settings. */
function goodRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'main',
    updated_at: '2026-11-09T12:00:00Z',
    pull_request_reviews_enforcement_level: 'everyone',
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: true,
    require_last_push_approval: true,
    required_status_checks: [...CONTEXTS],
    required_status_checks_enforcement_level: 'everyone',
    strict_required_status_checks_policy: true,
    admin_enforced: true,
    ...overrides,
  }
}

function event(overrides: Partial<DriftEvent> = {}): DriftEvent {
  return {action: 'edited', rule: goodRule(), changes: {}, sender: SETTINGS_ACTOR, ...overrides}
}

describe('parseDeclaredProtection', () => {
  it('reads the review fields and enforce_admins from common settings and the contexts from the repo file', () => {
    expect(parseDeclaredProtection(COMMON, REPO)).toEqual(DECLARED)
  })

  it('lets the repo file override a field, merging the nested blocks field by field', () => {
    const repo = `
branches:
  - name: main
    protection:
      enforce_admins: false
      required_status_checks:
        strict: false
        contexts: [Lint]
      required_pull_request_reviews:
        required_approving_review_count: 2
`
    expect(parseDeclaredProtection(COMMON, repo)).toEqual({
      reviewCount: 2,
      codeOwners: true,
      dismissStale: true,
      lastPush: true,
      strict: false,
      enforceAdmins: false,
      contexts: ['Lint'],
    })
  })

  it('takes strict from common settings when the repo file leaves it out', () => {
    const repo = 'branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts: [Lint]\n'
    expect(parseDeclaredProtection(COMMON, repo).strict).toBe(true)
  })

  it('drops contexts that are not strings', () => {
    const repo =
      'branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts:\n          - Lint\n          - Security: Private Leak Scan\n'
    expect(parseDeclaredProtection(COMMON, repo).contexts).toEqual(['Lint'])
  })

  it.each([
    ['no branches', 'a: 1\n'],
    ['no main', 'branches:\n  - name: other\n'],
    ['no protection', 'branches:\n  - name: main\n'],
    ['a document that is not a mapping', '- a\n'],
  ])('throws when common settings has %s', (_name, common) => {
    expect(() => parseDeclaredProtection(common, REPO)).toThrow('declared protection is incomplete')
  })

  it.each([
    ['review count', COMMON.replace('required_approving_review_count: 1', 'required_approving_review_count: many')],
    ['code owners', COMMON.replace('require_code_owner_reviews: true', 'require_code_owner_reviews: yes-please')],
    ['dismiss stale', COMMON.replace('dismiss_stale_reviews: true', 'dismiss_stale_reviews: 3')],
    ['last push', COMMON.replace('require_last_push_approval: true', 'require_last_push_approval: nope')],
    ['enforce_admins', COMMON.replace('enforce_admins: true', 'enforce_admins: always')],
  ])('throws when the declared %s is not the right type', (_name, common) => {
    expect(() => parseDeclaredProtection(common, REPO)).toThrow('declared protection is incomplete')
  })

  it('throws when the declared strict is not a boolean', () => {
    expect(() => parseDeclaredProtection(COMMON, REPO.replace('strict: true', 'strict: sure'))).toThrow(
      'declared protection is incomplete',
    )
  })

  it('throws when the declared contexts are not a list', () => {
    const repo = 'branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts: Lint\n'
    expect(() => parseDeclaredProtection(COMMON, repo)).toThrow('declared protection is incomplete')
  })

  it('finds main among entries that are not main, are not mappings, or are null', () => {
    const common = COMMON.replace(
      'branches:\n',
      'branches:\n  - null\n  - just a string\n  - name: other\n    protection:\n      enforce_admins: false\n',
    )
    expect(parseDeclaredProtection(common, REPO)).toEqual(DECLARED)
  })

  it('throws when no contexts are declared', () => {
    expect(() => parseDeclaredProtection(COMMON, 'branches:\n  - name: main\n')).toThrow(
      'declared protection is incomplete',
    )
  })

  it('throws on YAML that does not parse', () => {
    expect(() => parseDeclaredProtection('a: [', REPO)).toThrow()
  })

  it('reads the files checked into this repository', () => {
    const root = resolve(import.meta.dirname, '../../..')
    const declared = parseDeclaredProtection(
      readFileSync(resolve(root, 'common-settings.yaml'), 'utf8'),
      readFileSync(resolve(root, '.github/settings.yml'), 'utf8'),
    )
    expect(declared.contexts.length).toBeGreaterThan(5)
    expect(declared.contexts).toContain('Security: Private Leak Scan')
    expect(declared.reviewCount).toBeGreaterThanOrEqual(1)
    expect(declared.enforceAdmins).toBe(true)
  })
})

describe('assessEvent: which events are ignored', () => {
  it('ignores a rule other than main (a rule named for another branch or a wildcard)', () => {
    for (const name of ['develop', 'release/*', 'main*', 'Main', '']) {
      expect(assessEvent(event({rule: goodRule({name})}), DECLARED)).toEqual({kind: 'ignored', reason: 'other-rule'})
    }
  })

  it('ignores an action other than created, edited and deleted', () => {
    expect(assessEvent(event({action: 'renamed'}), DECLARED)).toEqual({kind: 'ignored', reason: 'other-action'})
    expect(assessEvent(event({action: ''}), DECLARED)).toEqual({kind: 'ignored', reason: 'other-action'})
  })

  it.each([undefined, null, 'main', 5, ['main']])('is malformed when the rule is %j', rule => {
    expect(assessEvent(event({rule}), DECLARED)).toEqual({kind: 'malformed'})
  })
})

describe('assessEvent: the settings automation matches by type and numeric id', () => {
  const evaluated = (sender: unknown) => {
    const result = assessEvent(event({sender}), DECLARED)
    return result.kind === 'evaluated' ? result.settingsActor : undefined
  }

  it('recognises the Fro Bot App bot', () => {
    expect(evaluated(SETTINGS_ACTOR)).toBe(true)
  })

  it('recognises it whatever the login says', () => {
    expect(evaluated({...SETTINGS_ACTOR, login: 'someone-else'})).toBe(true)
  })

  it('never takes the fro-bot user for the App, even with the App-like login', () => {
    expect(evaluated(OPERATOR_USER)).toBe(false)
    expect(evaluated({login: 'fro-bot[bot]', id: 42, type: 'User'})).toBe(false)
    expect(evaluated({login: 'fro-bot', id: 109_017_866, type: 'User'})).toBe(false)
  })

  it.each([
    {login: 'fro-bot[bot]', type: 'Bot'},
    {login: 'fro-bot[bot]', id: '109017866', type: 'Bot'},
    {login: 'fro-bot[bot]', id: 109_017_866},
    {login: 'fro-bot[bot]', id: 109_017_867, type: 'Bot'},
    {login: 'fro-bot[bot]', id: 109_017_866, type: 'bot'},
    null,
    undefined,
    'fro-bot[bot]',
    [],
  ])('does not recognise the sender %j', sender => {
    expect(evaluated(sender)).toBe(false)
  })
})

describe('assessEvent: the fields of the rule', () => {
  const assess = (overrides: Record<string, unknown>, sender: unknown = SETTINGS_ACTOR) => {
    const result = assessEvent(event({rule: goodRule(overrides), sender}), DECLARED)
    if (result.kind !== 'evaluated') throw new Error('expected an evaluated event')
    return result
  }

  it('finds nothing wrong with a rule that matches the declared settings', () => {
    expect(assess({})).toEqual({kind: 'evaluated', deleted: false, settingsActor: true, mismatched: [], absent: []})
  })

  it('reports the review count set to 0 (AE7)', () => {
    expect(assess({required_approving_review_count: 0}, OPERATOR_USER)).toMatchObject({
      mismatched: ['required_approving_review_count'],
      absent: [],
      settingsActor: false,
    })
  })

  it('treats a different count in either direction as a mismatch', () => {
    expect(assess({required_approving_review_count: 2}).mismatched).toEqual(['required_approving_review_count'])
  })

  it.each([
    ['require_code_owner_review', false],
    ['dismiss_stale_reviews_on_push', false],
    ['require_last_push_approval', false],
    ['strict_required_status_checks_policy', false],
    ['admin_enforced', false],
  ])('reports %s set to %s', (field, value) => {
    expect(assess({[field]: value}).mismatched).toEqual([field])
  })

  it('reports unchecking "Require a pull request" as a reviews enforcement level of off', () => {
    expect(assess({pull_request_reviews_enforcement_level: 'off'}).mismatched).toEqual([
      'pull_request_reviews_enforcement_level',
    ])
  })

  it('reports required status checks switched off', () => {
    expect(assess({required_status_checks_enforcement_level: 'off'}).mismatched).toEqual([
      'required_status_checks_enforcement_level',
    ])
  })

  it.each(['everyone', 'non_admins'])('accepts a %s enforcement level', level => {
    const result = assess({
      pull_request_reviews_enforcement_level: level,
      required_status_checks_enforcement_level: level,
    })
    expect(result.mismatched).toEqual([])
    expect(result.absent).toEqual([])
  })

  it('reports a rule that is missing a declared context, and passes one that has extra', () => {
    expect(assess({required_status_checks: ['Lint', 'Test']}).mismatched).toEqual(['required_status_checks'])
    expect(assess({required_status_checks: []}).mismatched).toEqual(['required_status_checks'])
    expect(assess({required_status_checks: [...CONTEXTS, 'Extra']}).mismatched).toEqual([])
  })

  it('lists several mismatches in a fixed order', () => {
    expect(
      assess({
        admin_enforced: false,
        required_approving_review_count: 0,
        required_status_checks: [],
        pull_request_reviews_enforcement_level: 'off',
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        strict_required_status_checks_policy: false,
        required_status_checks_enforcement_level: 'off',
      }).mismatched,
    ).toEqual([
      'pull_request_reviews_enforcement_level',
      'required_approving_review_count',
      'require_code_owner_review',
      'dismiss_stale_reviews_on_push',
      'require_last_push_approval',
      'required_status_checks_enforcement_level',
      'strict_required_status_checks_policy',
      'required_status_checks',
      'admin_enforced',
    ])
  })

  it('never counts a field the event does not report as a mismatch or as a match (R12)', () => {
    const fields = [
      'pull_request_reviews_enforcement_level',
      'required_approving_review_count',
      'require_code_owner_review',
      'dismiss_stale_reviews_on_push',
      'require_last_push_approval',
      'required_status_checks_enforcement_level',
      'strict_required_status_checks_policy',
      'required_status_checks',
      'admin_enforced',
    ]
    for (const field of fields) {
      const result = assess({[field]: undefined})
      expect(result.mismatched, field).toEqual([])
      expect(result.absent, field).toEqual([field])
    }
  })

  it('reports a missing require_last_push_approval as absent, never as a match', () => {
    const rule = goodRule()
    delete rule.require_last_push_approval
    const result = assessEvent(event({rule}), DECLARED)
    expect(result).toMatchObject({mismatched: [], absent: ['require_last_push_approval']})
  })

  it.each([null, 'yes', 1, [], {}])('treats a value of the wrong type (%j) as absent', value => {
    const result = assess({require_code_owner_review: value, admin_enforced: value})
    expect(result.mismatched).toEqual([])
    expect(result.absent).toEqual(['require_code_owner_review', 'admin_enforced'])
  })

  it.each([null, '1', true, Number.NaN])('treats a review count of %j as absent', value => {
    expect(assess({required_approving_review_count: value}).absent).toEqual(['required_approving_review_count'])
  })

  it.each([undefined, null, 'Lint', {0: 'Lint'}, ['Lint', 4]])(
    'treats required_status_checks of %j as absent',
    value => {
      const result = assess({required_status_checks: value})
      expect(result.absent).toEqual(['required_status_checks'])
      expect(result.mismatched).toEqual([])
    },
  )

  it.each([undefined, null, 5, true, 'sometimes', ''])('treats an enforcement level of %j as absent', value => {
    const result = assess({
      pull_request_reviews_enforcement_level: value,
      required_status_checks_enforcement_level: value,
    })
    expect(result.absent).toEqual([
      'pull_request_reviews_enforcement_level',
      'required_status_checks_enforcement_level',
    ])
    expect(result.mismatched).toEqual([])
  })

  it('judges the fields against the declared values it is given', () => {
    const declared: DeclaredProtection = {
      ...DECLARED,
      reviewCount: 2,
      strict: false,
      enforceAdmins: false,
      contexts: ['Only'],
    }
    const result = assessEvent(
      event({
        rule: goodRule({
          required_approving_review_count: 2,
          strict_required_status_checks_policy: false,
          admin_enforced: false,
          required_status_checks: ['Only'],
        }),
      }),
      declared,
    )
    expect(result).toMatchObject({mismatched: [], absent: []})
  })
})

describe('assessEvent: a deleted rule', () => {
  it('is drift, whoever deleted it, and its fields are not judged', () => {
    for (const sender of [SETTINGS_ACTOR, OPERATOR_USER]) {
      expect(assessEvent(event({action: 'deleted', sender}), DECLARED)).toEqual({
        kind: 'evaluated',
        deleted: true,
        settingsActor: sender === SETTINGS_ACTOR,
        mismatched: [],
        absent: [],
      })
    }
  })

  it('ignores the deleted rule of another branch', () => {
    expect(assessEvent(event({action: 'deleted', rule: goodRule({name: 'dev'})}), DECLARED)).toEqual({
      kind: 'ignored',
      reason: 'other-rule',
    })
  })

  it('judges a created rule like an edited one', () => {
    expect(assessEvent(event({action: 'created', rule: goodRule({admin_enforced: false})}), DECLARED)).toMatchObject({
      deleted: false,
      mismatched: ['admin_enforced'],
    })
  })
})

describe('planAction', () => {
  const evaluated = (
    patch: Partial<{deleted: boolean; settingsActor: boolean; mismatched: string[]; absent: string[]}>,
  ) => ({kind: 'evaluated', deleted: false, settingsActor: true, mismatched: [], absent: [], ...patch}) as const

  it('does nothing for an ignored event or a clean settings write with no issue open', () => {
    expect(planAction({kind: 'ignored', reason: 'other-rule'}, false)).toBe('none')
    expect(planAction({kind: 'ignored', reason: 'other-rule'}, true)).toBe('none')
    expect(planAction(evaluated({}), false)).toBe('none')
  })

  it('opens an issue for a non-settings actor, with the rule matching or not', () => {
    expect(planAction(evaluated({settingsActor: false}), false)).toBe('open')
    expect(planAction(evaluated({settingsActor: false, mismatched: ['admin_enforced']}), false)).toBe('open')
  })

  it('opens an issue when the settings App wrote a rule that does not match (an _extends fallback)', () => {
    expect(planAction(evaluated({mismatched: ['required_approving_review_count']}), false)).toBe('open')
  })

  it('opens an issue for a deleted rule', () => {
    expect(planAction(evaluated({deleted: true}), false)).toBe('open')
    expect(planAction(evaluated({deleted: true, settingsActor: false}), false)).toBe('open')
  })

  it('comments on the open issue instead of opening another', () => {
    expect(planAction(evaluated({settingsActor: false}), true)).toBe('comment')
    expect(planAction(evaluated({mismatched: ['admin_enforced']}), true)).toBe('comment')
    expect(planAction(evaluated({deleted: true}), true)).toBe('comment')
  })

  it('closes the open issue only on a settings write where every declared field is present and matching', () => {
    expect(planAction(evaluated({}), true)).toBe('close')
  })

  it('leaves the open issue alone, and closes nothing, when a settings write leaves a field absent', () => {
    expect(planAction(evaluated({absent: ['require_last_push_approval']}), true)).toBe('none')
    expect(planAction(evaluated({absent: ['require_last_push_approval']}), false)).toBe('none')
  })

  it('does not close on a restore by a non-settings actor', () => {
    expect(planAction(evaluated({settingsActor: false}), true)).toBe('comment')
  })

  it('does nothing for a malformed event', () => {
    expect(planAction({kind: 'malformed'}, true)).toBe('none')
  })
})

describe('renderReport', () => {
  const base = {
    action: 'edited',
    login: 'fro-bot',
    type: 'User',
    id: 42,
    at: '2026-11-09T12:00:00Z',
    changes: {required_approving_review_count: {from: '1'}},
    mismatched: ['required_approving_review_count'],
    absent: [] as string[],
    deleted: false,
    settingsActor: false,
  }

  it('names the actor, the time, the change, the mismatched fields and the workflow that restores the rule', () => {
    expect(renderReport(base)).toBe(
      [
        'The branch protection rule for `main` was edited outside the settings automation, or no longer matches the declared settings.',
        '',
        '- Actor: `fro-bot` (type `User`, id `42`)',
        '- When: 2026-11-09T12:00:00Z',
        '- Event: `edited`',
        '- Reported changes:',
        '  - `required_approving_review_count` (was `1`)',
        '- Fields that differ from the declared settings:',
        '  - `required_approving_review_count`',
        '',
        'Nothing was reverted. The daily [Update Repo Settings](https://github.com/fro-bot/.github/actions/workflows/update-repo-settings.yaml) run restores the declared settings, and this issue closes itself when a later write by the settings automation shows every declared setting present and matching.',
        '',
      ].join('\n'),
    )
  })

  it('says so when the event reports no changes, no differing fields and no absent ones', () => {
    const report = renderReport({...base, changes: {}, mismatched: []})
    expect(report).toContain('- Reported changes: none reported')
    expect(report).toContain('- Fields that differ from the declared settings: none')
    expect(report).not.toContain('Fields the event did not report')
  })

  it('lists the fields the event did not report', () => {
    const report = renderReport({...base, absent: ['require_last_push_approval', 'admin_enforced']})
    expect(report).toContain(
      [
        '- Fields the event did not report (never counted as drift or as a match):',
        '  - `require_last_push_approval`',
        '  - `admin_enforced`',
      ].join('\n'),
    )
  })

  it('says the rule was deleted', () => {
    const report = renderReport({...base, deleted: true, action: 'deleted'})
    expect(report).toContain('- Event: `deleted` (the rule no longer exists)')
  })

  it('does not call a drifting settings write an outside edit', () => {
    const report = renderReport({...base, settingsActor: true, login: 'fro-bot[bot]', type: 'Bot', id: 109_017_866})
    expect(report.split('\n')[0]).toBe(
      'The branch protection rule for `main` no longer matches the declared settings after a write by the settings automation.',
    )
  })

  it('renders only short scalar `from` values and strips backticks and line breaks from them', () => {
    const report = renderReport({
      ...base,
      changes: {
        a: {from: 'x`y\nz'},
        b: {from: 3},
        c: {from: false},
        d: {from: {nested: 1}},
        e: {from: 'q'.repeat(200)},
        f: 'not an object',
        g: {},
      },
    })
    expect(report).toContain('  - `a` (was `xy z`)')
    expect(report).toContain('  - `b` (was `3`)')
    expect(report).toContain('  - `c` (was `false`)')
    expect(report).toContain('  - `d`\n')
    expect(report).toContain(`  - \`e\` (was \`${'q'.repeat(80)}\`)`)
    expect(report).toContain('  - `f`\n')
    expect(report).toContain('  - `g`\n')
    expect(report).not.toContain('q'.repeat(81))
  })

  it('strips backticks and line breaks from the actor fields too', () => {
    const report = renderReport({...base, login: 'evil`\r\n\r\nlogin', type: 'Us`er'})
    expect(report).toContain('- Actor: `evil login` (type `User`, id `42`)')
  })

  it('reports an unknown actor id as unknown', () => {
    const report = renderReport({...base, id: undefined, login: undefined, type: undefined})
    expect(report).toContain('- Actor: `unknown` (type `unknown`, id `unknown`)')
  })

  it('treats a changes value that is not an object as no reported changes', () => {
    expect(renderReport({...base, changes: 'oops'})).toContain('- Reported changes: none reported')
    expect(renderReport({...base, changes: null})).toContain('- Reported changes: none reported')
    expect(renderReport({...base, changes: ['a']})).toContain('- Reported changes: none reported')
  })
})

interface IssueRecord {
  number: number
  pull_request?: unknown
}

function issueWorld(options: {open?: readonly IssueRecord[]; fail?: string; endless?: boolean} = {}) {
  const calls: {name: string; params: Record<string, unknown>}[] = []
  const guard = (name: string) => {
    if (options.fail === name) throw Object.assign(new Error('upstream body with a secret'), {status: 500})
  }
  const open = options.open ?? []
  const octokit = {
    rest: {
      issues: {
        listForRepo: async (params: Record<string, unknown>) => {
          calls.push({name: 'list', params})
          guard('list')
          const size = 100
          const page = params.page as number
          if (options.endless === true) {
            return {data: Array.from({length: size}, (_, index) => ({number: page * 1000 + index, pull_request: {}}))}
          }
          return {data: open.slice((page - 1) * size, page * size)}
        },
        create: async (params: Record<string, unknown>) => {
          calls.push({name: 'create', params})
          guard('create')
          return {data: {number: 900, html_url: 'https://github.com/fro-bot/.github/issues/900'}}
        },
        createComment: async (params: Record<string, unknown>) => {
          calls.push({name: 'comment', params})
          guard('comment')
          return {data: {}}
        },
        update: async (params: Record<string, unknown>) => {
          calls.push({name: 'close', params})
          guard('close')
          return {data: {}}
        },
      },
    },
  } as unknown as ProtectionDriftOctokit
  return {octokit, calls, names: () => calls.map(call => call.name)}
}

function runner(options: {
  event?: unknown
  eventText?: string
  common?: string
  repo?: string
  token?: string | undefined
  world?: ReturnType<typeof issueWorld>
  readFailure?: 'event' | 'common' | 'repo'
  env?: Record<string, string | undefined>
}) {
  const world = options.world ?? issueWorld()
  const stderr: string[] = []
  const stdout: string[] = []
  const writes: {path: string; content: string}[] = []
  const tokens: string[] = []
  const run = async () =>
    runProtectionDrift({
      env: {
        GITHUB_EVENT_PATH: '/event.json',
        GITHUB_TOKEN: 'ghs_secret',
        GITHUB_STEP_SUMMARY: '/summary',
        ...(options.token === undefined && 'token' in options ? {GITHUB_TOKEN: undefined} : {}),
        ...options.env,
      },
      readFile: path => {
        if (options.readFailure === 'event' && path === '/event.json') throw new Error('ENOENT /secret/path')
        if (options.readFailure === 'common' && path === 'common-settings.yaml') throw new Error('ENOENT /secret/path')
        if (options.readFailure === 'repo' && path === '.github/settings.yml') throw new Error('ENOENT /secret/path')
        if (path === '/event.json') return options.eventText ?? JSON.stringify(options.event ?? event())
        if (path === 'common-settings.yaml') return options.common ?? COMMON
        if (path === '.github/settings.yml') return options.repo ?? REPO
        throw new Error('ENOENT: no such file')
      },
      createClient: async token => {
        tokens.push(token)
        return world.octokit
      },
      now: () => new Date('2026-11-09T13:00:00Z'),
      stdout: text => stdout.push(text),
      stderr: text => stderr.push(text),
      append: (path, content) => writes.push({path, content}),
    })
  return {run, world, stderr, stdout, writes, tokens}
}

const DRIFT_EVENT = event({
  rule: goodRule({required_approving_review_count: 0}),
  changes: {required_approving_review_count: {from: '1'}},
  sender: {login: 'fro-bot', id: 42, type: 'User'},
})

describe('runProtectionDrift: opening and commenting', () => {
  it('opens one labelled issue naming the actor, the time and the change when the fro-bot user turns reviews off (AE7)', async () => {
    const h = runner({event: DRIFT_EVENT})
    expect(await h.run()).toBe(0)
    expect(h.world.names()).toEqual(['list', 'create'])
    expect(h.world.calls[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      state: 'open',
      labels: 'protection-drift',
      per_page: 100,
      page: 1,
    })
    const create = h.world.calls[1]?.params as {
      title: string
      body: string
      labels: string[]
      owner: string
      repo: string
    }
    expect(create.owner).toBe('fro-bot')
    expect(create.repo).toBe('.github')
    expect(create.title).toBe('Protection drift: main branch protection')
    expect(create.labels).toEqual(['protection-drift'])
    expect(create.body).toContain('- Actor: `fro-bot` (type `User`, id `42`)')
    expect(create.body).toContain('- When: 2026-11-09T12:00:00Z')
    expect(create.body).toContain('`required_approving_review_count` (was `1`)')
    expect(create.body).toContain('update-repo-settings.yaml')
    expect(h.stdout).toEqual(['protection-drift: opened #900\n'])
    expect(h.stderr).toEqual([])
    expect(h.tokens).toEqual(['ghs_secret'])
  })

  it('uses the time the run read when the rule carries none', async () => {
    const rule = goodRule({required_approving_review_count: 0})
    delete rule.updated_at
    const h = runner({event: event({rule, sender: OPERATOR_USER})})
    await h.run()
    expect((h.world.calls[1]?.params as {body: string}).body).toContain('- When: 2026-11-09T13:00:00.000Z')
  })

  it('comments on the open issue instead of opening another', async () => {
    const h = runner({event: DRIFT_EVENT, world: issueWorld({open: [{number: 31}]})})
    expect(await h.run()).toBe(0)
    expect(h.world.names()).toEqual(['list', 'comment'])
    expect(h.world.calls[1]?.params).toMatchObject({owner: 'fro-bot', repo: '.github', issue_number: 31})
    expect((h.world.calls[1]?.params as {body: string}).body).toContain('- Actor: `fro-bot`')
    expect(h.stdout).toEqual(['protection-drift: commented on #31\n'])
    expect(h.writes[0]?.content).toContain('### Protection drift: comment added')
    expect(h.writes[0]?.content).toContain('- Issue: #31')
  })

  it('picks the oldest open issue, and ignores pull requests that carry the label', async () => {
    const h = runner({
      event: DRIFT_EVENT,
      world: issueWorld({open: [{number: 5, pull_request: {}}, {number: 44}, {number: 41}, {number: 60}]}),
    })
    await h.run()
    expect(h.world.calls[1]?.params).toMatchObject({issue_number: 41})
  })

  it('finds an open issue on a later page', async () => {
    const open = Array.from({length: 100}, (_, index) => ({number: 1000 + index, pull_request: {}}))
    const h = runner({event: DRIFT_EVENT, world: issueWorld({open: [...open, {number: 77}]})})
    await h.run()
    expect(h.world.names()).toEqual(['list', 'list', 'comment'])
    expect(h.world.calls[1]?.params).toMatchObject({page: 2})
    expect(h.world.calls[2]?.params).toMatchObject({issue_number: 77})
  })

  it('reads at most 50 pages of open issues, then opens an issue if none of them is a real one', async () => {
    const h = runner({event: DRIFT_EVENT, world: issueWorld({endless: true})})
    expect(await h.run()).toBe(0)
    expect(h.world.names().filter(name => name === 'list')).toHaveLength(50)
    expect(h.world.calls.findLast(call => call.name === 'list')?.params).toMatchObject({page: 50})
    expect(h.world.names().at(-1)).toBe('create')
  })

  it('opens a new issue after a manual close, because only open issues count', async () => {
    const h = runner({event: DRIFT_EVENT, world: issueWorld({open: []})})
    await h.run()
    expect(h.world.names()).toEqual(['list', 'create'])
  })

  it('reports the operator restoring the rule by hand as a non-settings edit', async () => {
    const h = runner({event: event({sender: OPERATOR_USER}), world: issueWorld({open: [{number: 31}]})})
    await h.run()
    expect(h.world.names()).toEqual(['list', 'comment'])
  })

  it('reports a settings write that left out a review requirement (an _extends fallback)', async () => {
    const h = runner({
      event: event({
        rule: goodRule({pull_request_reviews_enforcement_level: 'off', required_approving_review_count: 0}),
      }),
    })
    await h.run()
    expect(h.world.names()).toEqual(['list', 'create'])
    expect((h.world.calls[1]?.params as {body: string}).body).toContain('after a write by the settings automation')
  })

  it('reports a non-settings change to an undeclared field, since the actor is not the settings App', async () => {
    const h = runner({
      event: event({rule: goodRule({allow_force_pushes_enforcement_level: 'everyone'}), sender: OPERATOR_USER}),
    })
    await h.run()
    expect(h.world.names()).toEqual(['list', 'create'])
  })

  it('reports a deleted rule', async () => {
    const h = runner({event: event({action: 'deleted', sender: SETTINGS_ACTOR})})
    await h.run()
    expect(h.world.names()).toEqual(['list', 'create'])
    expect((h.world.calls[1]?.params as {body: string}).body).toContain('(the rule no longer exists)')
  })
})

describe('runProtectionDrift: closing', () => {
  it('comments on the open issue and closes it when the settings App writes a matching rule (AE7)', async () => {
    const h = runner({event: event(), world: issueWorld({open: [{number: 31}]})})
    expect(await h.run()).toBe(0)
    expect(h.world.names()).toEqual(['list', 'comment', 'close'])
    expect(h.world.calls[1]?.params).toMatchObject({issue_number: 31})
    expect((h.world.calls[1]?.params as {body: string}).body).toBe(
      'The settings automation wrote the `main` rule at 2026-11-09T12:00:00Z and every declared setting is present and matching. Closing.',
    )
    expect(h.world.calls[2]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 31,
      state: 'closed',
      state_reason: 'completed',
    })
    expect(h.stdout).toEqual(['protection-drift: closed #31\n'])
    expect(h.writes[0]?.content).toBe('### Protection drift: issue closed\n\n- Issue: #31\n')
  })

  it('does nothing for a clean settings write with no issue open', async () => {
    const h = runner({event: event()})
    expect(await h.run()).toBe(0)
    expect(h.world.names()).toEqual(['list'])
    expect(h.stdout).toEqual(['protection-drift: no drift\n'])
  })

  it('keeps the issue open and lists the absent field in the summary when a settings write leaves one out', async () => {
    const rule = goodRule()
    delete rule.require_last_push_approval
    const h = runner({event: event({rule}), world: issueWorld({open: [{number: 31}]})})
    expect(await h.run()).toBe(0)
    expect(h.world.names()).toEqual(['list'])
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0]?.path).toBe('/summary')
    expect(h.writes[0]?.content).toContain('`require_last_push_approval`')
    expect(h.writes[0]?.content).toBe(
      '### Protection drift: fields not reported\n\nThese declared fields were not reported by the event, so they count neither as drift nor as a match, and the issue cannot close on this write: `require_last_push_approval`.\n',
    )
    expect(h.stdout).toEqual(['protection-drift: absent fields, issue left as it is\n'])
  })

  it('lists every absent field in the summary, separated by commas', async () => {
    const rule = goodRule()
    delete rule.require_last_push_approval
    delete rule.admin_enforced
    const h = runner({event: event({rule})})
    await h.run()
    expect(h.writes[0]?.content).toContain('`require_last_push_approval`, `admin_enforced`.')
  })

  it('is not fooled by a different closing time: it closes whatever the time of the event', async () => {
    const rule = goodRule()
    delete rule.updated_at
    const h = runner({event: event({rule}), world: issueWorld({open: [{number: 31}]})})
    await h.run()
    expect((h.world.calls[1]?.params as {body: string}).body).toContain('at 2026-11-09T13:00:00.000Z')
  })
})

describe('runProtectionDrift: ignored and failing events', () => {
  it('ignores a rule other than main and calls no API', async () => {
    const h = runner({event: event({rule: goodRule({name: 'develop'}), sender: OPERATOR_USER})})
    expect(await h.run()).toBe(0)
    expect(h.world.names()).toEqual([])
    expect(h.tokens).toEqual([])
    expect(h.stdout).toEqual(['protection-drift: ignored (other-rule)\n'])
  })

  it('ignores an action it does not handle', async () => {
    const h = runner({event: event({action: 'renamed'})})
    expect(await h.run()).toBe(0)
    expect(h.stdout).toEqual(['protection-drift: ignored (other-action)\n'])
  })

  it('exits 1 with a fixed line for a payload with no rule', async () => {
    const h = runner({event: {action: 'edited', sender: SETTINGS_ACTOR}})
    expect(await h.run()).toBe(1)
    expect(h.stderr).toEqual(['::error::protection-drift: MALFORMED_EVENT\n'])
    expect(h.world.names()).toEqual([])
  })

  it('opens an issue for an event with no sender, naming the actor as unknown', async () => {
    const payload = {action: 'edited', rule: goodRule({admin_enforced: false}), changes: {}}
    const h = runner({event: payload})
    expect(await h.run()).toBe(0)
    expect((h.world.calls[1]?.params as {body: string}).body).toContain(
      '- Actor: `unknown` (type `unknown`, id `unknown`)',
    )
  })

  it('exits 1 with a fixed line when the event cannot be read or parsed', async () => {
    const unreadable = runner({readFailure: 'event'})
    expect(await unreadable.run()).toBe(1)
    expect(unreadable.stderr).toEqual(['::error::protection-drift: EVENT_UNREADABLE\n'])
    const broken = runner({eventText: '{not json'})
    expect(await broken.run()).toBe(1)
    expect(broken.stderr).toEqual(['::error::protection-drift: EVENT_UNREADABLE\n'])
    for (const value of [undefined, '']) {
      const missing = runner({env: {GITHUB_EVENT_PATH: value}})
      expect(await missing.run()).toBe(1)
      expect(missing.stderr).toEqual(['::error::protection-drift: EVENT_UNREADABLE\n'])
    }
  })

  it.each([[['{}'][0]], ['[]'], ['null'], ['"text"'], ['5']])('exits 1 for the payload %s', async text => {
    const h = runner({eventText: text})
    expect(await h.run()).toBe(1)
    expect(h.stderr).toEqual(['::error::protection-drift: MALFORMED_EVENT\n'])
  })

  it('exits 1 with a fixed line when the settings cannot be read or are incomplete', async () => {
    for (const options of [{readFailure: 'common' as const}, {readFailure: 'repo' as const}, {common: 'a: 1\n'}]) {
      const h = runner(options)
      expect(await h.run()).toBe(1)
      expect(h.stderr).toEqual(['::error::protection-drift: SETTINGS_UNREADABLE\n'])
      expect(h.world.names()).toEqual([])
    }
  })

  it.each(['', undefined])('exits 1 without a token (%j)', async value => {
    const h = runner({env: {GITHUB_TOKEN: value}})
    expect(await h.run()).toBe(1)
    expect(h.stderr).toEqual(['::error::protection-drift: MISSING_TOKEN\n'])
    expect(h.tokens).toEqual([])
  })

  it.each(['list', 'create'])(
    'exits 1 with a fixed line when the issue API fails on %s, leaking nothing',
    async fail => {
      const h = runner({event: DRIFT_EVENT, world: issueWorld({fail})})
      expect(await h.run()).toBe(1)
      expect(h.stderr).toEqual(['::error::protection-drift: API_FAILED\n'])
      expect([...h.stderr, ...h.stdout, ...h.writes.map(write => write.content)].join('')).not.toContain('secret')
    },
  )

  it('exits 1 when the comment fails, and when the close fails', async () => {
    const comment = runner({event: DRIFT_EVENT, world: issueWorld({open: [{number: 1}], fail: 'comment'})})
    expect(await comment.run()).toBe(1)
    const close = runner({event: event(), world: issueWorld({open: [{number: 1}], fail: 'close'})})
    expect(await close.run()).toBe(1)
    expect(close.stderr).toEqual(['::error::protection-drift: API_FAILED\n'])
  })

  it('exits 1 when the client cannot be created, without leaking the token', async () => {
    const stderr: string[] = []
    const code = await runProtectionDrift({
      env: {GITHUB_EVENT_PATH: '/e', GITHUB_TOKEN: 'ghs_secret'},
      readFile: path => (path === '/e' ? JSON.stringify(DRIFT_EVENT) : path === 'common-settings.yaml' ? COMMON : REPO),
      createClient: async () => {
        throw new Error('bad token ghs_secret')
      },
      now: () => new Date(0),
      stdout: () => {},
      stderr: text => stderr.push(text),
      append: () => {},
    })
    expect(code).toBe(1)
    expect(stderr).toEqual(['::error::protection-drift: API_FAILED\n'])
  })

  it('writes the report to the job summary when it opens an issue, and none outside Actions', async () => {
    const h = runner({event: DRIFT_EVENT})
    await h.run()
    expect(h.writes[0]?.path).toBe('/summary')
    expect(h.writes[0]?.content).toContain('- Actor: `fro-bot`')
    expect(h.writes[0]?.content).toContain('Issue: https://github.com/fro-bot/.github/issues/900')
    const outside = runner({event: DRIFT_EVENT, env: {GITHUB_STEP_SUMMARY: undefined}})
    await outside.run()
    expect(outside.writes).toEqual([])
  })
})
