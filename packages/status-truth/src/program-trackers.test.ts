import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
// Relative import: the Stryker sandbox links node_modules to the real tree, so a package-name import
// would run against the un-mutated file and every mutant would survive.
import {
  confirmedReposMissing,
  isAuthorizedTrigger,
  isOperatorComment,
  isPublicVisibility,
  issueRef,
  loadProgramTrackers,
  parseProgramTrackers,
  partitionBootstrapRepos,
  reposConfirmedOnDefaultBranch,
  selectProgram,
  type ProgramEntry,
} from './program-trackers.ts'

function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'gateway',
    issue: 'fro-bot/.github#3512',
    project: {owner: 'fro-bot', number: 1, gateField: 'gateway Unit Gate'},
    operator: {id: 831617, login: 'marcusrbrown'},
    evidence: 'gateway',
    ...overrides,
  }
}

function configText(...programs: unknown[]): string {
  return JSON.stringify({programs})
}

function entryOf(overrides: Record<string, unknown> = {}): ProgramEntry {
  const config = parseProgramTrackers(configText(validEntry(overrides)))
  const entry = config.programs[0]
  if (entry === undefined) throw new Error('fixture has no program')
  return entry
}

describe('parseProgramTrackers: a valid file', () => {
  it('parses an entry into the fields the tracker reads', () => {
    expect(parseProgramTrackers(configText(validEntry()))).toEqual({
      programs: [
        {
          key: 'gateway',
          issue: 'fro-bot/.github#3512',
          project: {owner: 'fro-bot', number: 1, gateField: 'gateway Unit Gate'},
          operator: {id: 831617, login: 'marcusrbrown'},
          evidence: 'gateway',
        },
      ],
    })
  })

  it('keeps the confirmed repos when an entry has them', () => {
    const repos = [
      {nameWithOwner: 'marcusrbrown/opencode-a', nodeId: 'R_kgDOA'},
      {nameWithOwner: 'marcusrbrown/opencode-b', nodeId: 'R_kgDOB'},
    ]

    expect(entryOf({repos}).repos).toEqual(repos)
  })

  it('leaves repos out when an entry has none', () => {
    expect('repos' in entryOf()).toBe(false)
  })

  it('accepts the evidence kind none and several programs', () => {
    const config = parseProgramTrackers(
      configText(validEntry(), validEntry({key: 'opencode-v2', issue: 'fro-bot/.github#4200', evidence: 'none'})),
    )

    expect(config.programs.map(program => [program.key, program.evidence])).toEqual([
      ['gateway', 'gateway'],
      ['opencode-v2', 'none'],
    ])
  })

  it('drops fields it does not read', () => {
    const entry = entryOf({extra: 'x', project: {owner: 'fro-bot', number: 1, gateField: 'G', more: 1}})

    expect(Object.keys(entry).sort()).toEqual(['evidence', 'issue', 'key', 'operator', 'project'])
    expect(Object.keys(entry.project).sort()).toEqual(['gateField', 'number', 'owner'])
  })
})

describe('parseProgramTrackers: a config with every program closed out', () => {
  it('accepts an empty programs array as no programs', () => {
    expect(parseProgramTrackers('{"programs": []}')).toEqual({programs: []})
  })

  it('still names an explicit request for a removed program as unknown', () => {
    expect(() => selectProgram(parseProgramTrackers('{"programs": []}'), 'gateway')).toThrow(
      new Error('unknown program key'),
    )
  })
})

describe('parseProgramTrackers: rejects with a fixed message', () => {
  const programsMessage = 'program-trackers.json must hold a "programs" array'

  it.each([
    ['text that is not JSON', '{', 'program-trackers.json is not valid JSON'],
    ['an empty string', '', 'program-trackers.json is not valid JSON'],
  ])('%s', (_name, text, message) => {
    expect(() => parseProgramTrackers(text)).toThrow(new Error(message))
  })

  it.each([
    ['a top-level array', '[]'],
    ['a top-level null', 'null'],
    ['a top-level string', '"x"'],
    ['an object without programs', '{}'],
    ['programs that is not an array', '{"programs": {}}'],
  ])('%s', (_name, text) => {
    expect(() => parseProgramTrackers(text)).toThrow(new TypeError(programsMessage))
  })

  it.each([
    ['null', null],
    ['a string', 'gateway'],
    ['an array', []],
    ['a number', 7],
  ])('an entry that is %s', (_name, value) => {
    expect(() => parseProgramTrackers(configText(value))).toThrow(new Error('programs[0] must be an object'))
  })

  it('names the index of the entry that is wrong', () => {
    expect(() => parseProgramTrackers(configText(validEntry(), 5))).toThrow(new Error('programs[1] must be an object'))
  })

  it.each([
    ['a number', 1],
    ['an empty string', ''],
    ['uppercase', 'Gateway'],
    ['a leading hyphen', '-gateway'],
    ['a space', 'gate way'],
    ['a shell metacharacter', 'a;b'],
    ['a newline', 'gateway\nx'],
    ['an expression', `${'$'}{{ x }}`],
    ['an underscore', 'gate_way'],
    ['a slash', 'a/b'],
    ['null', null],
  ])('a key that is %s', (_name, key) => {
    expect(() => parseProgramTrackers(configText(validEntry({key})))).toThrow(new Error('programs[0].key is invalid'))
  })

  it.each([['a'], ['a1'], ['0'], ['opencode-v2'], ['a-b-c']])('accepts the key %s', key => {
    expect(entryOf({key}).key).toBe(key)
  })

  it.each([
    ['a number', 3512],
    ['no number', 'fro-bot/.github'],
    ['no repository', '#3512'],
    ['no owner', '.github#3512'],
    ['a zero number', 'fro-bot/.github#0'],
    ['a leading zero', 'fro-bot/.github#01'],
    ['a trailing letter', 'fro-bot/.github#12x'],
    ['a space in the repository', 'fro-bot/my repo#1'],
    ['a second slash', 'a/b/c#1'],
    ['a leading line', 'x\nfro-bot/.github#1'],
    ['a trailing line', 'fro-bot/.github#1\nx'],
    ['a negative number', 'fro-bot/.github#-1'],
    ['a url', 'https://github.com/fro-bot/.github/issues/1'],
  ])('an issue with %s', (_name, issue) => {
    expect(() => parseProgramTrackers(configText(validEntry({issue})))).toThrow(
      new Error('programs[0].issue is invalid'),
    )
  })

  it.each([['a/b#1'], ['fro-bot/.github#3512'], ['A_b.c-d/e.f_g-h#90']])('accepts the issue %s', issue => {
    expect(entryOf({issue}).issue).toBe(issue)
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'p'],
  ])('a project that is %s', (_name, project) => {
    expect(() => parseProgramTrackers(configText(validEntry({project})))).toThrow(
      new Error('programs[0].project is invalid'),
    )
  })

  it.each([
    ['a number', 7],
    ['empty', ''],
    ['with a space', 'fro bot'],
    ['with a slash', 'a/b'],
    ['with a newline', 'a\nb'],
    ['missing', undefined],
  ])('a project owner that is %s', (_name, owner) => {
    expect(() => parseProgramTrackers(configText(validEntry({project: {owner, number: 1, gateField: 'G'}})))).toThrow(
      new Error('programs[0].project.owner is invalid'),
    )
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a string', '1'],
    ['null', null],
    ['too large to be safe', 2 ** 53],
    ['missing', undefined],
  ])('a project number that is %s', (_name, number) => {
    expect(() =>
      parseProgramTrackers(configText(validEntry({project: {owner: 'fro-bot', number, gateField: 'G'}}))),
    ).toThrow(new Error('programs[0].project.number is invalid'))
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['a number', 1],
    ['missing', undefined],
  ])('a gate field that is %s', (_name, gateField) => {
    expect(() =>
      parseProgramTrackers(configText(validEntry({project: {owner: 'fro-bot', number: 1, gateField}}))),
    ).toThrow(new Error('programs[0].project.gateField is invalid'))
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'marcusrbrown'],
  ])('an operator that is %s', (_name, operator) => {
    expect(() => parseProgramTrackers(configText(validEntry({operator})))).toThrow(
      new Error('programs[0].operator is invalid'),
    )
  })

  it.each([
    ['a numeric string', '831617'],
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1.5],
    ['null', null],
    ['too large to be safe', 2 ** 53],
    ['missing', undefined],
  ])('an operator id that is %s', (_name, id) => {
    expect(() => parseProgramTrackers(configText(validEntry({operator: {id, login: 'marcusrbrown'}})))).toThrow(
      new Error('programs[0].operator.id is invalid'),
    )
  })

  it.each([
    ['empty', ''],
    ['a number', 1],
    ['with a space', 'marcus rbrown'],
    ['with a bracket', 'bot[bot]'],
    ['with a newline', 'a\nb'],
    ['missing', undefined],
  ])('an operator login that is %s', (_name, login) => {
    expect(() => parseProgramTrackers(configText(validEntry({operator: {id: 1, login}})))).toThrow(
      new Error('programs[0].operator.login is invalid'),
    )
  })

  it.each([
    ['missing', undefined],
    ['an unknown kind', 'both'],
    ['uppercase', 'Gateway'],
    ['a number', 1],
    ['null', null],
  ])('evidence that is %s', (_name, evidence) => {
    expect(() => parseProgramTrackers(configText(validEntry({evidence})))).toThrow(
      new Error('programs[0].evidence is invalid'),
    )
  })

  it.each([
    ['an object', {}],
    ['a string', 'a/b'],
    ['null', null],
  ])('repos that is %s', (_name, repos) => {
    expect(() => parseProgramTrackers(configText(validEntry({repos})))).toThrow(
      new Error('programs[0].repos is invalid'),
    )
  })

  it.each([
    ['a string', 'a/b'],
    ['null', null],
    ['an array', []],
    ['an entry without a name', {nodeId: 'R_1'}],
    ['a name with no owner', {nameWithOwner: 'repo', nodeId: 'R_1'}],
    ['a name with a space', {nameWithOwner: 'a/b c', nodeId: 'R_1'}],
    ['a name with a second slash', {nameWithOwner: 'a/b/c', nodeId: 'R_1'}],
    ['a name with a newline', {nameWithOwner: 'a/b\nx', nodeId: 'R_1'}],
    ['an entry without a node id', {nameWithOwner: 'a/b'}],
    ['an empty node id', {nameWithOwner: 'a/b', nodeId: ''}],
    ['a numeric node id', {nameWithOwner: 'a/b', nodeId: 1}],
  ])('a repo that is %s', (_name, repo) => {
    expect(() => parseProgramTrackers(configText(validEntry({repos: [repo]})))).toThrow(
      new Error('programs[0].repos[0] is invalid'),
    )
  })

  it('names the index of the repo that is wrong', () => {
    const repos = [{nameWithOwner: 'a/b', nodeId: 'R_1'}, {nameWithOwner: 'bad'}]

    expect(() => parseProgramTrackers(configText(validEntry({repos})))).toThrow(
      new Error('programs[0].repos[1] is invalid'),
    )
  })

  it('a repeated repo, ignoring case', () => {
    const repos = [
      {nameWithOwner: 'a/b', nodeId: 'R_1'},
      {nameWithOwner: 'A/B', nodeId: 'R_2'},
    ]

    expect(() => parseProgramTrackers(configText(validEntry({repos})))).toThrow(
      new Error('programs[0].repos has a duplicate repo'),
    )
  })

  it('accepts an empty repos array', () => {
    expect(entryOf({repos: []}).repos).toEqual([])
  })

  it('a repeated program key', () => {
    expect(() => parseProgramTrackers(configText(validEntry(), validEntry({issue: 'fro-bot/.github#9'})))).toThrow(
      new Error('duplicate program key'),
    )
  })

  it('a repeated tracker issue, ignoring case', () => {
    expect(() =>
      parseProgramTrackers(configText(validEntry(), validEntry({key: 'other', issue: 'FRO-BOT/.github#3512'}))),
    ).toThrow(new Error('duplicate tracker issue'))
  })

  it('reports the first problem of an entry in field order', () => {
    expect(() => parseProgramTrackers(configText({key: 'Bad', issue: 'x'}))).toThrow(
      new Error('programs[0].key is invalid'),
    )
    expect(() => parseProgramTrackers(configText({key: 'good', issue: 'x', project: 1}))).toThrow(
      new Error('programs[0].issue is invalid'),
    )
    expect(() => parseProgramTrackers(configText({key: 'good', issue: 'a/b#1', project: 1}))).toThrow(
      new Error('programs[0].project is invalid'),
    )
  })
})

describe('loadProgramTrackers', () => {
  const root = mkdtempSync(join(tmpdir(), 'program-trackers-'))
  afterAll(() => {
    rmSync(root, {recursive: true, force: true})
  })

  it('reads and parses the file at the path', () => {
    const path = join(root, 'good.json')
    writeFileSync(path, configText(validEntry()))

    expect(loadProgramTrackers(path).programs.map(program => program.key)).toEqual(['gateway'])
  })

  it('reports a missing file', () => {
    expect(() => loadProgramTrackers(join(root, 'absent.json'))).toThrow(new Error('program-trackers.json is missing'))
  })

  it('keeps the read error as the cause', () => {
    let caught: unknown
    try {
      loadProgramTrackers(join(root, 'absent-again.json'))
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).cause).toMatchObject({code: 'ENOENT'})
  })

  it('reports a path that cannot be read as a file', () => {
    const directory = join(root, 'a-directory')
    mkdirSync(directory)

    expect(() => loadProgramTrackers(directory)).toThrow(new Error('program-trackers.json cannot be read'))
  })

  it('reports malformed JSON and an invalid entry from the file', () => {
    const malformed = join(root, 'malformed.json')
    writeFileSync(malformed, '{')
    const invalid = join(root, 'invalid.json')
    writeFileSync(invalid, configText(validEntry({key: ''})))

    expect(() => loadProgramTrackers(malformed)).toThrow(new Error('program-trackers.json is not valid JSON'))
    expect(() => loadProgramTrackers(invalid)).toThrow(new Error('programs[0].key is invalid'))
  })

  it('loads the committed file', () => {
    const committed = loadProgramTrackers(resolve(import.meta.dirname, '../../../program-trackers.json'))
    const gateway = committed.programs.find(program => program.key === 'gateway')

    expect(gateway).toEqual({
      key: 'gateway',
      issue: 'fro-bot/.github#3512',
      project: {owner: 'fro-bot', number: 1, gateField: 'gateway Unit Gate'},
      operator: {id: 831617, login: 'marcusrbrown'},
      evidence: 'gateway',
    })
  })
})

describe('selectProgram and issueRef', () => {
  const config = parseProgramTrackers(
    configText(validEntry(), validEntry({key: 'opencode-v2', issue: 'marcusrbrown/plugins#42', evidence: 'none'})),
  )

  it('selects the entry with the key', () => {
    expect(selectProgram(config, 'opencode-v2').issue).toBe('marcusrbrown/plugins#42')
    expect(selectProgram(config, 'gateway').issue).toBe('fro-bot/.github#3512')
  })

  it.each([[''], ['Gateway'], ['missing'], ['gateway ']])('rejects the unknown key %j', key => {
    expect(() => selectProgram(config, key)).toThrow(new Error('unknown program key'))
  })

  it('splits the tracker issue into its repository and number', () => {
    expect(issueRef(selectProgram(config, 'gateway'))).toEqual({repo: 'fro-bot/.github', number: 3512})
    expect(issueRef(selectProgram(config, 'opencode-v2'))).toEqual({repo: 'marcusrbrown/plugins', number: 42})
  })
})

describe('isOperatorComment', () => {
  const entry = entryOf()

  it('is true for the operator login', () => {
    expect(isOperatorComment({author: {login: 'marcusrbrown'}}, entry)).toBe(true)
  })

  it('is false, with no numeric id, for anyone else, including the bot and a near match', () => {
    for (const login of ['octocat', 'fro-bot', 'fro-bot[bot]', 'marcusrbrown2', ' marcusrbrown', '']) {
      expect(isOperatorComment({author: {login}}, entry)).toBe(false)
    }
  })

  it('compares the login ignoring case when the comment carries no numeric id', () => {
    expect(isOperatorComment({author: {login: 'MarcusRBrown'}}, entry)).toBe(true)
    expect(isOperatorComment({author: {login: 'MARCUSRBROWN'}}, entry)).toBe(true)
  })

  it('matches on the numeric id alone when the comment carries one', () => {
    expect(isOperatorComment({author: {login: 'marcusrbrown', id: 831617}}, entry)).toBe(true)
    expect(isOperatorComment({author: {login: 'marcusrbrown', id: 999}}, entry)).toBe(false)
    expect(isOperatorComment({author: {login: 'marcusrbrown', id: 0}}, entry)).toBe(false)
  })

  it('accepts the operator id under a mixed-case or renamed login', () => {
    expect(isOperatorComment({author: {login: 'MarcusRBrown', id: 831617}}, entry)).toBe(true)
    expect(isOperatorComment({author: {login: 'octocat', id: 831617}}, entry)).toBe(true)
  })

  it('does not accept the operator login under another id, whatever the case', () => {
    expect(isOperatorComment({author: {login: 'MarcusRBrown', id: 1}}, entry)).toBe(false)
  })
})

describe('isAuthorizedTrigger', () => {
  const entry = entryOf()
  const operatorMention = {author: {login: 'marcusrbrown'}, body: 'ping @fro-bot'}
  const operatorPlain = {author: {login: 'marcusrbrown'}, body: 'G4c pass'}
  const stranger = {author: {login: 'octocat'}, body: '@fro-bot G4c pass'}

  it('accepts the operator mentioning the bot on a created comment', () => {
    expect(isAuthorizedTrigger(operatorMention, entry, 'created')).toBe(true)
    expect(isAuthorizedTrigger({...operatorMention, body: '@FRO-BOT hi'}, entry, 'created')).toBe(true)
  })

  it('rejects an operator created comment without a mention', () => {
    expect(isAuthorizedTrigger(operatorPlain, entry, 'created')).toBe(false)
  })

  it('accepts an operator edit without a mention', () => {
    expect(isAuthorizedTrigger(operatorPlain, entry, 'edited')).toBe(true)
    expect(isAuthorizedTrigger({author: {login: 'marcusrbrown'}, body: ''}, entry, 'edited')).toBe(true)
  })

  it('treats a missing event kind like a created comment', () => {
    expect(isAuthorizedTrigger(operatorMention, entry, '')).toBe(true)
    expect(isAuthorizedTrigger(operatorPlain, entry, '')).toBe(false)
  })

  it('rejects anyone but the operator, whatever the event', () => {
    expect(isAuthorizedTrigger(stranger, entry, 'created')).toBe(false)
    expect(isAuthorizedTrigger(stranger, entry, 'edited')).toBe(false)
    expect(isAuthorizedTrigger(stranger, entry, '')).toBe(false)
  })

  it('rejects the operator login with the wrong numeric id', () => {
    expect(isAuthorizedTrigger({author: {login: 'marcusrbrown', id: 1}, body: '@fro-bot'}, entry, 'created')).toBe(
      false,
    )
    expect(isAuthorizedTrigger({author: {login: 'marcusrbrown', id: 1}, body: 'x'}, entry, 'edited')).toBe(false)
  })
})

describe('confirmedReposMissing', () => {
  const repos = [
    {nameWithOwner: 'marcusrbrown/plugin-a', nodeId: 'R_a'},
    {nameWithOwner: 'marcusrbrown/plugin-b', nodeId: 'R_b'},
    {nameWithOwner: 'marcusrbrown/plugin-c', nodeId: 'R_c'},
  ]
  const entry = entryOf({repos})
  const allPublic = new Set(repos.map(repo => repo.nameWithOwner))

  it('returns the confirmed repos that have no Project item, in config order', () => {
    const items = [{content_repo: 'marcusrbrown/plugin-b'}]

    expect(confirmedReposMissing(entry, items, allPublic)).toEqual([repos[0], repos[2]])
  })

  it('returns nothing once every confirmed repo has an item', () => {
    const items = repos.map(repo => ({content_repo: repo.nameWithOwner}))

    expect(confirmedReposMissing(entry, items, allPublic)).toEqual([])
  })

  it('returns every confirmed repo for an empty Project', () => {
    expect(confirmedReposMissing(entry, [], allPublic)).toEqual(repos)
  })

  it('matches repo names ignoring case', () => {
    const items = [{content_repo: 'MarcusRBrown/Plugin-A'}]

    expect(confirmedReposMissing(entry, items, new Set(['MARCUSRBROWN/PLUGIN-A', 'marcusrbrown/plugin-c']))).toEqual([
      repos[2],
    ])
  })

  it('ignores a confirmed repo that is not public any more', () => {
    expect(confirmedReposMissing(entry, [], new Set(['marcusrbrown/plugin-a']))).toEqual([repos[0]])
    expect(confirmedReposMissing(entry, [], new Set())).toEqual([])
  })

  it('returns nothing for an entry without confirmed repos', () => {
    expect(confirmedReposMissing(entryOf(), [], allPublic)).toEqual([])
    expect(confirmedReposMissing(entryOf({repos: []}), [], allPublic)).toEqual([])
  })

  it('does not count an item from an unconfirmed repo', () => {
    const items = [{content_repo: 'someone/else'}]

    expect(confirmedReposMissing(entry, items, allPublic)).toEqual(repos)
  })
})

describe('reposConfirmedOnDefaultBranch', () => {
  const a = {nameWithOwner: 'marcusrbrown/plugin-a', nodeId: 'R_a'}
  const b = {nameWithOwner: 'marcusrbrown/plugin-b', nodeId: 'R_b'}
  const c = {nameWithOwner: 'marcusrbrown/plugin-c', nodeId: 'R_c'}
  const onMain = (...programs: ReturnType<typeof entryOf>[]): {programs: ReturnType<typeof entryOf>[]} => ({programs})

  it('keeps the repos that are still confirmed for the same program on the default branch, in order', () => {
    const config = onMain(entryOf({repos: [c, a]}))

    expect(reposConfirmedOnDefaultBranch([a, b, c], config, 'gateway')).toEqual([a, c])
  })

  it('returns nothing when the program is absent from the default branch', () => {
    expect(reposConfirmedOnDefaultBranch([a, b], onMain(), 'gateway')).toEqual([])
    expect(reposConfirmedOnDefaultBranch([a], onMain(entryOf({key: 'other', repos: [a]})), 'gateway')).toEqual([])
  })

  it('returns nothing when the program has no confirmed repos on the default branch', () => {
    expect(reposConfirmedOnDefaultBranch([a], onMain(entryOf()), 'gateway')).toEqual([])
    expect(reposConfirmedOnDefaultBranch([a], onMain(entryOf({repos: []})), 'gateway')).toEqual([])
  })

  it('matches repo names ignoring case', () => {
    const config = onMain(entryOf({repos: [{nameWithOwner: 'MarcusRBrown/Plugin-A', nodeId: 'R_a'}]}))

    expect(reposConfirmedOnDefaultBranch([a], config, 'gateway')).toEqual([a])
  })

  it('does not keep a repo whose node id changed, which is another repo under the same name', () => {
    const config = onMain(entryOf({repos: [{nameWithOwner: a.nameWithOwner, nodeId: 'R_other'}]}))

    expect(reposConfirmedOnDefaultBranch([a], config, 'gateway')).toEqual([])
  })

  it('does not keep a repo that shares a node id with a confirmed repo of another name', () => {
    const config = onMain(entryOf({repos: [{nameWithOwner: 'marcusrbrown/plugin-z', nodeId: a.nodeId}]}))

    expect(reposConfirmedOnDefaultBranch([a], config, 'gateway')).toEqual([])
  })

  it('returns nothing for an empty list', () => {
    expect(reposConfirmedOnDefaultBranch([], onMain(entryOf({repos: [a]})), 'gateway')).toEqual([])
  })

  it('reads only the entry with the program key', () => {
    const config = onMain(entryOf({key: 'other', issue: 'a/b#1', repos: [a]}), entryOf({repos: [b]}))

    expect(reposConfirmedOnDefaultBranch([a, b], config, 'gateway')).toEqual([b])
  })
})

describe('partitionBootstrapRepos', () => {
  const repos = [
    {nameWithOwner: 'marcusrbrown/plugin-a', nodeId: 'R_a'},
    {nameWithOwner: 'marcusrbrown/plugin-b', nodeId: 'R_b'},
    {nameWithOwner: 'marcusrbrown/plugin-c', nodeId: 'R_c'},
  ]

  it('puts every repo in ready when none has issues disabled', () => {
    expect(partitionBootstrapRepos(repos, new Set())).toEqual({ready: repos, blocked: []})
  })

  it('moves the repos with issues disabled to blocked, keeping config order on both sides', () => {
    const result = partitionBootstrapRepos(repos, new Set(['marcusrbrown/plugin-b']))

    expect(result).toEqual({ready: [repos[0], repos[2]], blocked: [repos[1]]})
  })

  it('matches names ignoring case', () => {
    const result = partitionBootstrapRepos(repos, new Set(['MARCUSRBROWN/PLUGIN-A']))

    expect(result).toEqual({ready: [repos[1], repos[2]], blocked: [repos[0]]})
  })

  it('blocks every repo when all have issues disabled, and handles an empty list', () => {
    expect(partitionBootstrapRepos(repos, new Set(repos.map(repo => repo.nameWithOwner)))).toEqual({
      ready: [],
      blocked: repos,
    })
    expect(partitionBootstrapRepos([], new Set(['marcusrbrown/plugin-a']))).toEqual({ready: [], blocked: []})
  })
})

describe('isPublicVisibility', () => {
  it.each([['public'], ['PUBLIC'], ['Public']])('accepts %s', value => {
    expect(isPublicVisibility(value)).toBe(true)
  })

  it.each([['private'], ['PRIVATE'], ['internal'], [''], [' public'], ['public '], ['publicly'], ['unknown']])(
    'rejects %j',
    value => {
      expect(isPublicVisibility(value)).toBe(false)
    },
  )
})
