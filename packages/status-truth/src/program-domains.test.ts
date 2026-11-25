import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
// Relative imports: the Stryker sandbox links node_modules to the real tree, so a package-name import
// would run against the un-mutated file and every mutant would survive.
import {
  checkDomainReposInRegistry,
  checkProgramDomainRefs,
  loadProgramDomains,
  parseProgramDomains,
  selectDomain,
  type RegistryRepo,
} from './program-domains.ts'
import {parseProgramTrackers} from './program-trackers.ts'

function validBrief(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    security: ['Pull request jobs set persist-credentials: false'],
    automation: ['Agent steps load repo skills'],
    developerExperience: ['The repository has an AGENTS.md'],
    exceptions: [],
    ...overrides,
  }
}

function validDomain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'harness-tools',
    repos: [
      {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_systematic'},
      {nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus'},
    ],
    brief: validBrief(),
    ...overrides,
  }
}

function configText(...domains: unknown[]): string {
  return JSON.stringify({domains})
}

function parseOne(overrides: Record<string, unknown> = {}) {
  const config = parseProgramDomains(configText(validDomain(overrides)))
  const domain = config.domains[0]
  if (domain === undefined) throw new Error('fixture has no domain')
  return domain
}

describe('parseProgramDomains: a valid file', () => {
  it('parses a domain into the fields the foreman reads', () => {
    expect(parseProgramDomains(configText(validDomain()))).toEqual({
      domains: [
        {
          key: 'harness-tools',
          repos: [
            {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_systematic'},
            {nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus'},
          ],
          brief: {
            security: ['Pull request jobs set persist-credentials: false'],
            automation: ['Agent steps load repo skills'],
            developerExperience: ['The repository has an AGENTS.md'],
            exceptions: [],
          },
        },
      ],
    })
  })

  it('keeps a per-repository exception that names a repository of the domain, ignoring case', () => {
    const exceptions = [{nameWithOwner: 'FRO-BOT/space-bus', reason: 'Has no skills directory yet'}]

    expect(parseOne({brief: validBrief({exceptions})}).brief.exceptions).toEqual(exceptions)
  })

  it('accepts a brief with standards in only one of the three areas', () => {
    const brief = validBrief({security: [], automation: ['One automation standard'], developerExperience: []})

    expect(parseOne({brief}).brief.automation).toEqual(['One automation standard'])
  })

  it('drops fields it does not read', () => {
    const domain = parseOne({extra: 'x', brief: validBrief({more: 1})})

    expect(Object.keys(domain).sort()).toEqual(['brief', 'key', 'repos'])
    expect(Object.keys(domain.brief).sort()).toEqual(['automation', 'developerExperience', 'exceptions', 'security'])
  })

  it('accepts an empty domains array as no domains', () => {
    expect(parseProgramDomains('{"domains": []}')).toEqual({domains: []})
  })

  it('accepts several domains with different repositories', () => {
    const other = validDomain({key: 'wiki', repos: [{nameWithOwner: 'a/b', nodeId: 'R_ab'}]})

    expect(parseProgramDomains(configText(validDomain(), other)).domains.map(domain => domain.key)).toEqual([
      'harness-tools',
      'wiki',
    ])
  })
})

describe('parseProgramDomains: rejects with a fixed message', () => {
  const domainsMessage = 'program-domains.json must hold a "domains" array'

  it.each([
    ['text that is not JSON', '{'],
    ['an empty string', ''],
  ])('%s', (_name, text) => {
    expect(() => parseProgramDomains(text)).toThrow(new Error('program-domains.json is not valid JSON'))
  })

  it.each([
    ['a top-level array', '[]'],
    ['a top-level null', 'null'],
    ['a top-level string', '"x"'],
    ['an object without domains', '{}'],
    ['domains that is not an array', '{"domains": {}}'],
  ])('%s', (_name, text) => {
    expect(() => parseProgramDomains(text)).toThrow(new TypeError(domainsMessage))
  })

  it.each([
    ['null', null],
    ['a string', 'harness-tools'],
    ['an array', []],
    ['a number', 7],
  ])('a domain that is %s', (_name, value) => {
    expect(() => parseProgramDomains(configText(value))).toThrow(new Error('domains[0] must be an object'))
  })

  it('names the index of the domain that is wrong', () => {
    expect(() => parseProgramDomains(configText(validDomain(), 5))).toThrow(new Error('domains[1] must be an object'))
  })

  it.each([
    ['a number', 1],
    ['an empty string', ''],
    ['uppercase', 'Harness'],
    ['a leading hyphen', '-harness'],
    ['a space', 'harness tools'],
    ['a newline', 'harness\nx'],
    ['an underscore', 'harness_tools'],
    ['a slash', 'a/b'],
    ['null', null],
    ['missing', undefined],
  ])('a key that is %s', (_name, key) => {
    expect(() => parseProgramDomains(configText(validDomain({key})))).toThrow(new Error('domains[0].key is invalid'))
  })

  it.each([['a'], ['a1'], ['0'], ['harness-tools'], ['a-b-c']])('accepts the key %s', key => {
    expect(parseOne({key}).key).toBe(key)
  })

  it('a repeated domain key', () => {
    const other = validDomain({repos: [{nameWithOwner: 'a/b', nodeId: 'R_ab'}]})

    expect(() => parseProgramDomains(configText(validDomain(), other))).toThrow(new Error('duplicate domain key'))
  })

  it.each([
    ['missing', undefined],
    ['an object', {}],
    ['a string', 'a/b'],
    ['null', null],
    ['an empty array', []],
  ])('repos that is %s', (_name, repos) => {
    expect(() => parseProgramDomains(configText(validDomain({repos})))).toThrow(
      new Error('domains[0].repos is invalid'),
    )
  })

  it.each([
    ['a string', 'a/b'],
    ['null', null],
    ['an array', []],
    ['an entry without a name', {nodeId: 'R_1'}],
    ['a name with no owner', {nameWithOwner: 'repo', nodeId: 'R_1'}],
    ['a name with a space', {nameWithOwner: 'a/b c', nodeId: 'R_1'}],
    ['a name with a newline', {nameWithOwner: 'a/b\nx', nodeId: 'R_1'}],
    ['an entry without a node id', {nameWithOwner: 'a/b'}],
    ['an empty node id', {nameWithOwner: 'a/b', nodeId: ''}],
    ['a numeric node id', {nameWithOwner: 'a/b', nodeId: 1}],
  ])('a repo that is %s', (_name, repo) => {
    expect(() => parseProgramDomains(configText(validDomain({repos: [repo]})))).toThrow(
      new Error('domains[0].repos[0] is invalid'),
    )
  })

  it('names the index of the repo that is wrong', () => {
    const repos = [{nameWithOwner: 'a/b', nodeId: 'R_1'}, {nameWithOwner: 'bad'}]

    expect(() => parseProgramDomains(configText(validDomain({repos})))).toThrow(
      new Error('domains[0].repos[1] is invalid'),
    )
  })

  it('a repo repeated inside a domain, ignoring case', () => {
    const repos = [
      {nameWithOwner: 'a/b', nodeId: 'R_1'},
      {nameWithOwner: 'A/B', nodeId: 'R_2'},
    ]

    expect(() => parseProgramDomains(configText(validDomain({repos})))).toThrow(
      new Error('domains[0].repos has a duplicate repo'),
    )
  })

  it('a repo in two domains', () => {
    const second = validDomain({
      key: 'other',
      repos: [{nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus'}],
    })

    expect(() => parseProgramDomains(configText(validDomain(), second))).toThrow(
      new Error('a repo is listed in two domains'),
    )
  })

  it('a repo in two domains that differs only in case', () => {
    const second = validDomain({
      key: 'other',
      repos: [{nameWithOwner: 'FRO-BOT/Space-Bus', nodeId: 'R_space_bus'}],
    })

    expect(() => parseProgramDomains(configText(validDomain(), second))).toThrow(
      new Error('a repo is listed in two domains'),
    )
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'standards'],
  ])('a brief that is %s', (_name, brief) => {
    expect(() => parseProgramDomains(configText(validDomain({brief})))).toThrow(
      new Error('domains[0].brief is invalid'),
    )
  })

  it.each(['security', 'automation', 'developerExperience', 'exceptions'])('a brief without %s', area => {
    const brief = validBrief()
    delete brief[area]

    expect(() => parseProgramDomains(configText(validDomain({brief})))).toThrow(
      new Error(`domains[0].brief.${area} is invalid`),
    )
  })

  it.each(['security', 'automation', 'developerExperience'])('a %s list that is not an array', area => {
    expect(() => parseProgramDomains(configText(validDomain({brief: validBrief({[area]: 'standard'})})))).toThrow(
      new Error(`domains[0].brief.${area} is invalid`),
    )
  })

  it.each([
    ['a number', 1],
    ['null', null],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['an object', {}],
  ])('a standard that is %s', (_name, standard) => {
    expect(() =>
      parseProgramDomains(configText(validDomain({brief: validBrief({automation: ['Fine', standard]})}))),
    ).toThrow(new Error('domains[0].brief.automation[1] is invalid'))
  })

  it('an empty brief', () => {
    const brief = validBrief({security: [], automation: [], developerExperience: []})

    expect(() => parseProgramDomains(configText(validDomain({brief})))).toThrow(new Error('domains[0].brief is empty'))
  })

  it('a brief that holds only exceptions is still empty', () => {
    const brief = validBrief({
      security: [],
      automation: [],
      developerExperience: [],
      exceptions: [{nameWithOwner: 'fro-bot/space-bus', reason: 'Why'}],
    })

    expect(() => parseProgramDomains(configText(validDomain({brief})))).toThrow(new Error('domains[0].brief is empty'))
  })

  it.each([
    ['a string', 'x'],
    ['null', null],
    ['an array', []],
    ['an entry without a name', {reason: 'Why'}],
    ['an entry without a reason', {nameWithOwner: 'fro-bot/space-bus'}],
    ['a blank reason', {nameWithOwner: 'fro-bot/space-bus', reason: '  '}],
    ['a numeric reason', {nameWithOwner: 'fro-bot/space-bus', reason: 1}],
    ['a malformed name', {nameWithOwner: 'space-bus', reason: 'Why'}],
    ['a repository outside the domain', {nameWithOwner: 'fro-bot/dashboard', reason: 'Why'}],
  ])('an exception that is %s', (_name, exception) => {
    expect(() => parseProgramDomains(configText(validDomain({brief: validBrief({exceptions: [exception]})})))).toThrow(
      new Error('domains[0].brief.exceptions[0] is invalid'),
    )
  })

  it('names the index of the exception that is wrong', () => {
    const exceptions = [{nameWithOwner: 'fro-bot/space-bus', reason: 'Why'}, {reason: 'No name'}]

    expect(() => parseProgramDomains(configText(validDomain({brief: validBrief({exceptions})})))).toThrow(
      new Error('domains[0].brief.exceptions[1] is invalid'),
    )
  })

  it('never echoes content from the file in a message', () => {
    const secret = 'Sk_live_do_not_echo'
    const attempts = [
      configText(validDomain({key: secret})),
      configText(validDomain({repos: [{nameWithOwner: secret, nodeId: secret}]})),
      configText(validDomain({brief: validBrief({security: [1, secret]})})),
      configText(validDomain({brief: validBrief({exceptions: [{nameWithOwner: secret, reason: secret}]})})),
      `{"domains": [${JSON.stringify(secret)}]}`,
    ]

    for (const text of attempts) {
      let message = ''
      try {
        parseProgramDomains(text)
      } catch (error) {
        message = error instanceof Error ? error.message : ''
      }
      expect(message).not.toBe('')
      expect(message).not.toContain(secret)
    }
  })

  it('reports the first problem of a domain in field order', () => {
    expect(() => parseProgramDomains(configText({key: 'Bad', repos: 1}))).toThrow(
      new Error('domains[0].key is invalid'),
    )
    expect(() => parseProgramDomains(configText({key: 'good', repos: 1, brief: 1}))).toThrow(
      new Error('domains[0].repos is invalid'),
    )
  })
})

describe('loadProgramDomains', () => {
  const root = mkdtempSync(join(tmpdir(), 'program-domains-'))
  afterAll(() => {
    rmSync(root, {recursive: true, force: true})
  })

  it('loads and parses a file', () => {
    const file = join(root, 'domains.json')
    writeFileSync(file, configText(validDomain()))

    expect(loadProgramDomains(file).domains.map(domain => domain.key)).toEqual(['harness-tools'])
  })

  it('says the file is missing when the path does not exist', () => {
    expect(() => loadProgramDomains(join(root, 'absent.json'))).toThrow(new Error('program-domains.json is missing'))
  })

  it('says the file cannot be read for another read failure, and keeps the cause', () => {
    const directory = join(root, 'a-directory')
    mkdirSync(directory)

    expect(() => loadProgramDomains(directory)).toThrow(new Error('program-domains.json cannot be read'))
    try {
      loadProgramDomains(directory)
    } catch (error) {
      expect((error as Error).cause).toBeDefined()
    }
  })

  it('reports malformed JSON from a file', () => {
    const malformed = join(root, 'malformed.json')
    writeFileSync(malformed, '{')

    expect(() => loadProgramDomains(malformed)).toThrow(new Error('program-domains.json is not valid JSON'))
  })
})

describe('selectDomain', () => {
  const config = parseProgramDomains(configText(validDomain()))

  it('returns the domain with the key', () => {
    expect(selectDomain(config, 'harness-tools').key).toBe('harness-tools')
  })

  it('fails with a fixed message for an unknown key', () => {
    expect(() => selectDomain(config, 'nope')).toThrow(new Error('unknown domain key'))
  })
})

describe('checkDomainReposInRegistry', () => {
  const config = parseProgramDomains(configText(validDomain()))
  const registry: RegistryRepo[] = [
    {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_systematic', private: false, archived: false},
    {nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus', private: false, archived: false},
    {nameWithOwner: 'fro-bot/other', nodeId: 'R_other', private: false, archived: false},
  ]

  function withRepo(name: string, changes: Partial<RegistryRepo>): RegistryRepo[] {
    return registry.map(repo => (repo.nameWithOwner === name ? {...repo, ...changes} : repo))
  }

  it('accepts public, unarchived repositories that the registry tracks', () => {
    expect(() => checkDomainReposInRegistry(config, registry)).not.toThrow()
  })

  it('matches names ignoring case', () => {
    const folded = registry.map(repo => ({...repo, nameWithOwner: repo.nameWithOwner.toUpperCase()}))

    expect(() => checkDomainReposInRegistry(config, folded)).not.toThrow()
  })

  it('accepts no domains', () => {
    expect(() => checkDomainReposInRegistry({domains: []}, [])).not.toThrow()
  })

  it('fails for a repository the registry does not list', () => {
    expect(() => checkDomainReposInRegistry(config, registry.slice(1))).toThrow(
      new Error('domains[0].repos[0] is not in metadata/repos.yaml'),
    )
  })

  it('names the index of the repository that is absent', () => {
    expect(() => checkDomainReposInRegistry(config, [registry[0] as RegistryRepo])).toThrow(
      new Error('domains[0].repos[1] is not in metadata/repos.yaml'),
    )
  })

  it('fails for a private repository', () => {
    expect(() => checkDomainReposInRegistry(config, withRepo('fro-bot/space-bus', {private: true}))).toThrow(
      new Error('domains[0].repos[1] is private'),
    )
  })

  it('fails for an archived repository', () => {
    expect(() => checkDomainReposInRegistry(config, withRepo('marcusrbrown/systematic', {archived: true}))).toThrow(
      new Error('domains[0].repos[0] is archived'),
    )
  })

  it('fails when the node ID differs from the registry', () => {
    expect(() => checkDomainReposInRegistry(config, withRepo('fro-bot/space-bus', {nodeId: 'R_other_id'}))).toThrow(
      new Error('domains[0].repos[1] has a node ID that differs from metadata/repos.yaml'),
    )
  })

  it('reports absent before private, private before archived, archived before a node ID mismatch', () => {
    const both = withRepo('marcusrbrown/systematic', {private: true, archived: true, nodeId: 'R_x'})
    expect(() => checkDomainReposInRegistry(config, both)).toThrow(new Error('domains[0].repos[0] is private'))

    const archivedAndMismatch = withRepo('marcusrbrown/systematic', {archived: true, nodeId: 'R_x'})
    expect(() => checkDomainReposInRegistry(config, archivedAndMismatch)).toThrow(
      new Error('domains[0].repos[0] is archived'),
    )
  })

  it('names the domain index in the message', () => {
    const second = validDomain({key: 'second', repos: [{nameWithOwner: 'fro-bot/other', nodeId: 'R_other'}]})
    const two = parseProgramDomains(configText(validDomain(), second))

    expect(() => checkDomainReposInRegistry(two, withRepo('fro-bot/other', {private: true}))).toThrow(
      new Error('domains[1].repos[0] is private'),
    )
  })

  it('never echoes a repository name or node ID', () => {
    let message = ''
    try {
      checkDomainReposInRegistry(config, [])
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }

    expect(message).not.toBe('')
    expect(message).not.toContain('systematic')
    expect(message).not.toContain('R_systematic')
  })
})

function trackers(...entries: Record<string, unknown>[]) {
  return parseProgramTrackers(JSON.stringify({programs: entries}))
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'gateway',
    issue: 'fro-bot/.github#3512',
    project: {owner: 'fro-bot', number: 1, gateField: 'gateway Unit Gate'},
    operator: {id: 831617, login: 'marcusrbrown'},
    evidence: 'gateway',
    ...overrides,
  }
}

describe('checkProgramDomainRefs', () => {
  const domains = parseProgramDomains(configText(validDomain()))

  it('accepts a program that names a domain in the file', () => {
    expect(() => checkProgramDomainRefs(trackers(entry({domain: 'harness-tools'})), domains)).not.toThrow()
  })

  it('accepts a program with no domain, even when there are no domains', () => {
    expect(() => checkProgramDomainRefs(trackers(entry()), {domains: []})).not.toThrow()
  })

  it('fails with a fixed message for an unknown domain and names the program index', () => {
    const config = trackers(entry(), entry({key: 'second', issue: 'fro-bot/.github#9', domain: 'no-such-domain'}))

    expect(() => checkProgramDomainRefs(config, domains)).toThrow(
      new Error('programs[1].domain is not in program-domains.json'),
    )
  })

  it('fails when there are no domains at all', () => {
    expect(() => checkProgramDomainRefs(trackers(entry({domain: 'harness-tools'})), {domains: []})).toThrow(
      new Error('programs[0].domain is not in program-domains.json'),
    )
  })
})

describe('the committed program-domains.json', () => {
  const root = resolve(import.meta.dirname, '../../..')
  const committed = loadProgramDomains(resolve(root, 'program-domains.json'))

  /**
   * `metadata/repos.yaml` is written by the registry code as a flat list of entries, two-space indented, each
   * starting at `- owner:` with scalar fields below it. Reading it with this small scanner keeps the YAML
   * parser out of this package's dependencies. A field the scanner does not know is ignored.
   */
  function readRegistry(): RegistryRepo[] {
    const text = readFileSync(resolve(root, 'metadata/repos.yaml'), 'utf8')
    const repos: RegistryRepo[] = []
    for (const block of text.split(/^ {2}- (?=owner:)/m).slice(1)) {
      const fields = new Map<string, string>()
      for (const line of block.split('\n')) {
        const match = /^ {0,4}(?<name>[a-z_]+): (?<value>.*)$/.exec(line)
        if (match?.groups !== undefined) fields.set(match.groups.name ?? '', (match.groups.value ?? '').trim())
      }
      const owner = fields.get('owner')
      const name = fields.get('name')
      const nodeId = fields.get('node_id')
      if (owner === undefined || name === undefined || nodeId === undefined) {
        throw new Error('registry entry is missing a field')
      }
      repos.push({
        nameWithOwner: `${owner}/${name}`,
        nodeId,
        private: fields.get('private') === 'true',
        archived: fields.get('onboarding_status') === 'archived',
      })
    }
    return repos
  }

  it('lists the harness-tools domain with its three repositories', () => {
    const harness = selectDomain(committed, 'harness-tools')

    expect(harness.repos.map(repo => repo.nameWithOwner)).toEqual([
      'marcusrbrown/systematic',
      'fro-bot/space-bus',
      'fro-bot/dashboard',
    ])
  })

  it('gives the brief standards for the three areas and leaves no repository an exception it has not earned', () => {
    const {brief} = selectDomain(committed, 'harness-tools')

    expect(brief.security.length).toBeGreaterThan(0)
    expect(brief.automation.length).toBeGreaterThan(0)
    expect(brief.developerExperience.length).toBeGreaterThan(0)
    expect(brief.exceptions).toEqual([])
  })

  it('lists only public, unarchived repositories the registry tracks, with the registry node IDs', () => {
    expect(() => checkDomainReposInRegistry(committed, readRegistry())).not.toThrow()
  })

  it('reads the registry the way the registry lists it: three harness-tools repositories are present', () => {
    const names = new Set(readRegistry().map(repo => repo.nameWithOwner))

    for (const repo of selectDomain(committed, 'harness-tools').repos) {
      expect(names.has(repo.nameWithOwner)).toBe(true)
    }
  })

  it('lists no repository in two domains', () => {
    const names = committed.domains.flatMap(domain => domain.repos.map(repo => repo.nameWithOwner.toLowerCase()))

    expect(new Set(names).size).toBe(names.length)
  })

  it('is referenced only by programs in program-trackers.json that name a domain it has', () => {
    const trackers = parseProgramTrackers(readFileSync(resolve(root, 'program-trackers.json'), 'utf8'))

    expect(() => checkProgramDomainRefs(trackers, committed)).not.toThrow()
    expect(trackers.programs.find(program => program.key === 'gateway')).toBeDefined()
  })
})
