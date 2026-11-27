import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
// Relative imports: the Stryker sandbox links node_modules to the real tree, so a package-name import
// would run against the un-mutated file and every mutant would survive.
import {
  checkDomainReposInRegistry,
  checkProgramDomainRefs,
  findIneligibleDomainRepos,
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

  it.each([
    ['security and automation', [1, 1, 0]],
    ['security and developer experience', [1, 0, 1]],
    ['automation and developer experience', [0, 1, 1]],
    ['security alone', [1, 0, 0]],
    ['developer experience alone', [0, 0, 1]],
  ])('accepts standards in %s', (_name, [security, automation, developerExperience]) => {
    const standards = (count: number | undefined): string[] => Array.from({length: count ?? 0}, () => 'A standard')
    const brief = validBrief({
      security: standards(security),
      automation: standards(automation),
      developerExperience: standards(developerExperience),
    })

    expect(parseOne({brief}).brief.security).toHaveLength(security ?? 0)
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

  it('a domain that shares exactly one of several repos with an earlier domain', () => {
    const second = validDomain({
      key: 'other',
      repos: [
        {nameWithOwner: 'a/unshared-one', nodeId: 'R_u1'},
        {nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus_second'},
        {nameWithOwner: 'a/unshared-two', nodeId: 'R_u2'},
      ],
    })

    expect(() => parseProgramDomains(configText(validDomain(), second))).toThrow(
      new Error('a repo is listed in two domains'),
    )
  })

  it('a domain whose repo matches only the last of several repos of an earlier domain', () => {
    const second = validDomain({
      key: 'other',
      repos: [{nameWithOwner: 'marcusrbrown/SYSTEMATIC', nodeId: 'R_other_id'}],
    })
    const first = validDomain({
      repos: [
        {nameWithOwner: 'a/one', nodeId: 'R_1'},
        {nameWithOwner: 'a/two', nodeId: 'R_2'},
        {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_systematic'},
      ],
    })

    expect(() => parseProgramDomains(configText(first, second))).toThrow(new Error('a repo is listed in two domains'))
  })

  it('distinct repos that share a node ID inside one domain', () => {
    const repos = [
      {nameWithOwner: 'a/one', nodeId: 'R_same'},
      {nameWithOwner: 'a/two', nodeId: 'R_same'},
    ]

    expect(() => parseProgramDomains(configText(validDomain({repos})))).toThrow(
      new Error('domains[0].repos[1] repeats a node ID'),
    )
  })

  it('distinct repos that share a node ID across domains, naming the later position', () => {
    const second = validDomain({
      key: 'other',
      repos: [
        {nameWithOwner: 'a/one', nodeId: 'R_one'},
        {nameWithOwner: 'a/two', nodeId: 'R_space_bus'},
      ],
    })

    expect(() => parseProgramDomains(configText(validDomain(), second))).toThrow(
      new Error('domains[1].repos[1] repeats a node ID'),
    )
  })

  it('node IDs that differ only in case are different node IDs', () => {
    const repos = [
      {nameWithOwner: 'a/one', nodeId: 'R_abc'},
      {nameWithOwner: 'a/two', nodeId: 'R_ABC'},
    ]

    expect(parseOne({repos}).repos).toHaveLength(2)
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

  it('fails when the node ID differs only in case', () => {
    // A GraphQL node ID is case-sensitive, so a registry row whose ID differs by case is another object.
    expect(() => checkDomainReposInRegistry(config, withRepo('fro-bot/space-bus', {nodeId: 'R_SPACE_BUS'}))).toThrow(
      new Error('domains[0].repos[1] has a node ID that differs from metadata/repos.yaml'),
    )
  })

  it('reports a private repository before an archived one', () => {
    const both = withRepo('marcusrbrown/systematic', {private: true, archived: true})

    expect(() => checkDomainReposInRegistry(config, both)).toThrow(new Error('domains[0].repos[0] is private'))
  })

  it('reports a node ID mismatch before private or archived', () => {
    const mismatch = withRepo('marcusrbrown/systematic', {archived: true, private: true, nodeId: 'R_x'})

    expect(() => checkDomainReposInRegistry(config, mismatch)).toThrow(
      new Error('domains[0].repos[0] has a node ID that differs from metadata/repos.yaml'),
    )
  })

  describe('a name and node ID that do not resolve to exactly one registry row', () => {
    const publicRow: RegistryRepo = {
      nameWithOwner: 'fro-bot/space-bus',
      nodeId: 'R_space_bus',
      private: false,
      archived: false,
    }
    const privateRow: RegistryRepo = {...publicRow, private: true}
    const single = parseProgramDomains(
      configText(validDomain({repos: [{nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus'}]})),
    )
    const byName = 'domains[0].repos[0] matches more than one row of metadata/repos.yaml by name'
    const byId = 'domains[0].repos[0] matches more than one row of metadata/repos.yaml by node ID'

    it.each([
      ['public row first', [publicRow, privateRow]],
      ['private row first', [privateRow, publicRow]],
    ])('rejects two rows with the same name and node ID, %s', (_name, rows) => {
      expect(() => checkDomainReposInRegistry(single, rows)).toThrow(new Error(byName))
    })

    it.each([
      ['public row first', [publicRow, {...privateRow, nodeId: 'R_other_id'}]],
      ['private row first', [{...privateRow, nodeId: 'R_other_id'}, publicRow]],
    ])('rejects two rows with the same name and different node IDs, %s', (_name, rows) => {
      expect(() => checkDomainReposInRegistry(single, rows)).toThrow(new Error(byName))
    })

    it.each([
      ['public row first', [publicRow, {...privateRow, nameWithOwner: 'fro-bot/renamed'}]],
      ['private row first', [{...privateRow, nameWithOwner: 'fro-bot/renamed'}, publicRow]],
    ])('rejects distinct names that share the node ID, %s', (_name, rows) => {
      expect(() => checkDomainReposInRegistry(single, rows)).toThrow(new Error(byId))
    })

    it('rejects a name differing only in case that matches two rows', () => {
      const rows = [publicRow, {...privateRow, nameWithOwner: 'FRO-BOT/Space-Bus', nodeId: 'R_x'}]

      expect(() => checkDomainReposInRegistry(single, rows)).toThrow(new Error(byName))
    })

    it.each([
      [
        'name row first',
        [
          {...publicRow, nodeId: 'R_x'},
          {...publicRow, nameWithOwner: 'fro-bot/renamed'},
        ],
      ],
      [
        'node ID row first',
        [
          {...publicRow, nameWithOwner: 'fro-bot/renamed'},
          {...publicRow, nodeId: 'R_x'},
        ],
      ],
    ])('rejects a name and node ID that point at different rows, %s', (_name, rows) => {
      expect(() => checkDomainReposInRegistry(single, rows)).toThrow(
        new Error('domains[0].repos[0] has a name and a node ID that name different registry rows'),
      )
    })

    it('accepts the one row that holds both, among other rows', () => {
      const rows = [{...publicRow, nameWithOwner: 'fro-bot/other', nodeId: 'R_other'}, publicRow]

      expect(() => checkDomainReposInRegistry(single, rows)).not.toThrow()
    })
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

describe('findIneligibleDomainRepos', () => {
  const registry: RegistryRepo[] = [
    {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_systematic', private: false, archived: false},
    {nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus', private: false, archived: false},
    {nameWithOwner: 'fro-bot/other', nodeId: 'R_other', private: false, archived: false},
  ]
  const second = validDomain({key: 'second', repos: [{nameWithOwner: 'fro-bot/other', nodeId: 'R_other'}]})
  const config = parseProgramDomains(configText(validDomain(), second))

  it('lists nothing when every repository is eligible', () => {
    expect(findIneligibleDomainRepos(config, registry)).toEqual([])
  })

  it('lists no domains as nothing', () => {
    expect(findIneligibleDomainRepos({domains: []}, [])).toEqual([])
  })

  it('lists every ineligible repository, not only the first, with its position and message', () => {
    const rows = registry
      .filter(repo => repo.nameWithOwner !== 'marcusrbrown/systematic')
      .map(repo => (repo.nameWithOwner === 'fro-bot/other' ? {...repo, archived: true} : repo))

    expect(findIneligibleDomainRepos(config, rows)).toEqual([
      {domainIndex: 0, repoIndex: 0, reason: 'domains[0].repos[0] is not in metadata/repos.yaml'},
      {domainIndex: 1, repoIndex: 0, reason: 'domains[1].repos[0] is archived'},
    ])
  })

  it('reports a repository once, with the same problem checkDomainReposInRegistry throws for it', () => {
    const rows = registry.map(repo =>
      repo.nameWithOwner === 'fro-bot/space-bus' ? {...repo, private: true, archived: true} : repo,
    )

    expect(findIneligibleDomainRepos(config, rows)).toEqual([
      {domainIndex: 0, repoIndex: 1, reason: 'domains[0].repos[1] is private'},
    ])
    expect(() => checkDomainReposInRegistry(config, rows)).toThrow(new Error('domains[0].repos[1] is private'))
  })

  it('names no repository and no node ID in a reason', () => {
    const reasons = findIneligibleDomainRepos(config, []).map(problem => problem.reason)

    expect(reasons).toHaveLength(3)
    for (const reason of reasons) {
      expect(reason).not.toContain('R_')
      expect(reason).not.toContain('fro-bot/')
      expect(reason).not.toContain('marcusrbrown/')
    }
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

  // Whether each listed repository is tracked, public and not archived is checked where the domain is used
  // (checkDomainReposInRegistry), not here: a registry change must never fail a pull request or a promotion.

  it('lists the harness-tools domain with its repositories', () => {
    const harness = selectDomain(committed, 'harness-tools')

    expect(harness.repos.map(repo => repo.nameWithOwner)).toEqual([
      'marcusrbrown/systematic',
      'fro-bot/space-bus',
      'fro-bot/dashboard',
      'marcusrbrown/metacogs',
      'marcusrbrown/opencode-copilot-delegate',
      'marcusrbrown/dev-like',
      'marcusrbrown/mothership',
    ])
  })

  it('gives the brief standards for the three areas and records only the exception systematic has earned', () => {
    const {brief, repos} = selectDomain(committed, 'harness-tools')

    expect(brief.security.length).toBeGreaterThan(0)
    expect(brief.automation.length).toBeGreaterThan(0)
    expect(brief.developerExperience.length).toBeGreaterThan(0)
    // The release-notes prompt dispatch stays comment-only by a documented contract; no other repository is excused.
    expect(brief.exceptions.map(exception => exception.nameWithOwner)).toEqual(['marcusrbrown/systematic'])
    for (const exception of brief.exceptions) {
      expect(repos.map(repo => repo.nameWithOwner)).toContain(exception.nameWithOwner)
      expect(exception.reason).toMatch(/comment-only/)
      expect(exception.reason).toMatch(/dispatch-to-pull-request/)
    }
  })

  it('words each standard so it can be checked against repository state, with no reference to this repository', () => {
    const {brief} = selectDomain(committed, 'harness-tools')
    const standards = [...brief.security, ...brief.automation, ...brief.developerExperience].join('\n')

    expect(standards).toContain('FRO_BOT_MODEL')
    expect(standards).toContain('.agents/skills/')
    expect(standards).toContain('automerge')
    expect(standards).toContain('commit SHA')
    expect(standards).not.toMatch(/agent-model resolver|composite/i)
  })

  it('requires one model expression with exclusive tier conditions, each falling back to FRO_BOT_MODEL inside its own condition', () => {
    const {brief} = selectDomain(committed, 'harness-tools')
    const standards = [...brief.security, ...brief.automation, ...brief.developerExperience]

    expect(standards).toContain(
      "Each agent step's model is selected by one expression whose tier conditions are mutually exclusive, and each tier falls back to FRO_BOT_MODEL inside its own condition, so an unset tier variable never passes the choice to another tier.",
    )
    expect(standards.join('\n')).not.toContain('chosen by the kind of work, falling back to FRO_BOT_MODEL')
  })

  it('scopes the checkout standard to checkout steps defined in this repository, not in external reusable workflows', () => {
    const {brief} = selectDomain(committed, 'harness-tools')

    expect(brief.security[0]).toBe(
      'For jobs that run on pull requests, issues or comments, set persist-credentials: false on every checkout step defined in this repository. Checkout steps defined in external reusable workflows are outside this standard.',
    )
    expect(brief.security).not.toContain(
      'Every job that runs on a pull request, an issue or a comment checks out with persist-credentials: false.',
    )
    expect(brief.security).not.toContain(
      'Every job this repository defines that runs on a pull request, an issue or a comment checks out with persist-credentials: false.',
    )
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
