import type {
  CrossRepoDispatchOctokitClient,
  DispatchItem,
  DispatchTarget,
  GateEntry,
  GoalState,
} from './dispatch-model.ts'
import {Buffer} from 'node:buffer'
import {describe, expect, it, vi} from 'vitest'
import {loadBriefFile} from './dispatch-github.ts'
import {buildMarkerComment, extractMarker} from './dispatch-marker.ts'
import {isGoalStateBody, REQUIRED_APPROVER} from './dispatch-model.ts'
import {checkBriefIdentity, parseBriefDomain, parseBriefReference} from './dispatch-plan.ts'
import {parseDecomposition} from './dispatch-receipts.ts'
import {runDispatch} from './dispatch-run.ts'

const REPO = {owner: 'fro-bot', repo: '.github'}
const COMMIT = 'a'.repeat(40)
const DASHBOARD: DispatchTarget = {owner: 'fro-bot', name: 'dashboard'}

interface MockComment {
  id: number
  body: string
  login: string
}

/** The smallest client `runDispatch` needs: comments in memory, every write recorded. */
function mockOctokit(comments: MockComment[]): CrossRepoDispatchOctokitClient {
  let nextId = comments.length + 1
  return {
    rest: {
      issues: {
        listComments: async () => ({data: comments.map(c => ({id: c.id, body: c.body, user: {login: c.login}}))}),
        createComment: async params => {
          const comment = {id: nextId, body: params.body, login: 'fro-bot'}
          nextId += 1
          comments.push(comment)
          return {data: {id: comment.id}}
        },
        updateComment: async params => {
          const existing = comments.find(c => c.id === params.comment_id)
          if (existing !== undefined) existing.body = params.body
          return {}
        },
        update: async () => ({}),
        removeLabel: async () => ({}),
        listForRepo: async () => ({data: []}),
      },
      actions: {
        createWorkflowDispatch: async () => ({}),
        listWorkflowRunsForRepo: async () => ({data: {workflow_runs: []}}),
      },
    },
  }
}

/** A registry row for `target`, with a node ID the base `GateEntry` has no field for yet. */
function row(target: DispatchTarget, nodeId: string | undefined, changes: Partial<GateEntry> = {}): GateEntry {
  return {
    owner: target.owner,
    name: target.name,
    has_fro_bot_workflow: true,
    private: false,
    ...(nodeId === undefined ? {} : {node_id: nodeId}),
    ...changes,
  }
}

function pendingGoal(target: DispatchTarget, prompt: string): {comments: MockComment[]; item: DispatchItem} {
  const checklist = `<!-- fro-bot:cross-repo-items:start -->\n- [ ] ${target.owner}/${target.name}: ${prompt}\n<!-- fro-bot:cross-repo-items:end -->`
  const parsed = parseDecomposition(checklist)
  const item = parsed.items[0]
  if (item === undefined) throw new TypeError('the fixture checklist did not parse')
  const state: GoalState = {goal: 'goal-1', items: [item], markerHash: ''}
  return {
    comments: [
      {id: 1, body: checklist, login: 'fro-bot'},
      {id: 2, body: buildMarkerComment(state), login: 'fro-bot'},
    ],
    item,
  }
}

async function dispatch(input: {
  comments: MockComment[]
  registry: GateEntry[]
  extra?: Record<string, unknown>
}): Promise<{
  counts: Awaited<ReturnType<typeof runDispatch>>['counts']
  dispatched: {owner: string; repo: string; prompt: string}[]
  comments: MockComment[]
}> {
  const dispatched: {owner: string; repo: string; prompt: string}[] = []
  const result = await runDispatch({
    octokit: mockOctokit(input.comments),
    event: {label: {name: 'dispatch-approved'}, sender: {login: REQUIRED_APPROVER}, issue: {number: 42}},
    repo: REPO,
    approveLabel: 'dispatch-approved',
    loadRegistry: async () => input.registry,
    loadOtherOpenGoalMarkers: async () => [],
    findRunByCorrelationId: async () => false,
    createWorkflowDispatch: async params => {
      dispatched.push({owner: params.owner, repo: params.repo, prompt: params.inputs.prompt})
    },
    nonceSource: () => 'nonce-1',
    ...input.extra,
  })
  return {counts: result.counts, dispatched, comments: input.comments}
}

describe('runDispatch: a goal whose items carry no domain brief reference', () => {
  it('dispatches an item whatever node ID its registry row carries, and reads no brief', async () => {
    const goal = pendingGoal(DASHBOARD, 'Update the docs')
    const loadBriefFile = vi.fn(async () => '')

    const result = await dispatch({
      comments: goal.comments,
      registry: [row(DASHBOARD, 'R_anything')],
      extra: {loadBriefFile},
    })

    expect(result.counts).toMatchObject({dispatched: 1, blocked: 0})
    expect(result.dispatched).toHaveLength(1)
    expect(loadBriefFile).not.toHaveBeenCalled()
  })

  it('dispatches an item whose prompt only mentions program-domains.json without the brief form', async () => {
    const goal = pendingGoal(DASHBOARD, 'Read program-domains.json and report')

    const result = await dispatch({comments: goal.comments, registry: [row(DASHBOARD, undefined)]})

    expect(result.counts).toMatchObject({dispatched: 1, blocked: 0})
  })
})

/** The part of `program-domains.json` dispatch reads: one domain, its repositories and their node IDs. */
function briefFile(repos: readonly {nameWithOwner: string; nodeId: string}[], key = 'harness-tools'): string {
  return JSON.stringify({
    domains: [{key, repos, brief: {security: ['s'], automation: ['a'], developerExperience: ['d'], exceptions: []}}],
  })
}

const BRIEF_LINE = (commit = COMMIT, domain = 'harness-tools'): string =>
  `Bring this repository to the brief. Brief: program-domains.json@${commit}#${domain}. Part issue: https://github.com/fro-bot/dashboard/issues/3`

describe('parseBriefReference', () => {
  it('is null for a prompt with no reference', () => {
    expect(parseBriefReference('Update the docs')).toBeNull()
  })

  it('reads the commit and the domain of the checklist line format', () => {
    expect(parseBriefReference(BRIEF_LINE())).toStrictEqual({commit: COMMIT, domain: 'harness-tools'})
  })

  it('reads the reference at the end of a prompt', () => {
    expect(parseBriefReference(`Do it. Brief: program-domains.json@${COMMIT}#harness-tools`)).toStrictEqual({
      commit: COMMIT,
      domain: 'harness-tools',
    })
  })

  it.each([
    ['a short commit', 'Brief: program-domains.json@abc123#harness-tools. Part issue: x'],
    ['an upper-case commit', `Brief: program-domains.json@${'A'.repeat(40)}#harness-tools.`],
    ['a missing domain', `Brief: program-domains.json@${COMMIT}. Part issue: x`],
    ['a domain that starts with a dash', `Brief: program-domains.json@${COMMIT}#-x.`],
    ['a 41-character commit', `Brief: program-domains.json@${'a'.repeat(41)}#harness-tools.`],
  ])('is malformed for %s, so a half-written reference never passes as no reference', (_name, prompt) => {
    expect(parseBriefReference(prompt)).toBe('malformed')
  })

  it('is malformed for two different references', () => {
    const prompt = `${BRIEF_LINE()} Also Brief: program-domains.json@${'b'.repeat(40)}#harness-tools.`

    expect(parseBriefReference(prompt)).toBe('malformed')
  })

  it('reads one reference written twice the same way', () => {
    expect(parseBriefReference(`${BRIEF_LINE()} ${BRIEF_LINE()}`)).toStrictEqual({
      commit: COMMIT,
      domain: 'harness-tools',
    })
  })
})

describe('parseBriefDomain', () => {
  const repos = [
    {nameWithOwner: 'Fro-Bot/Dashboard', nodeId: 'R_dash'},
    {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_sys'},
  ]

  it('maps each repository of the domain, by lower-cased name, to its node ID', () => {
    const ids = parseBriefDomain(briefFile(repos), 'harness-tools')

    expect([...ids]).toStrictEqual([
      ['fro-bot/dashboard', 'R_dash'],
      ['marcusrbrown/systematic', 'R_sys'],
    ])
  })

  it('reads the domain by key among several', () => {
    const text = JSON.stringify({
      domains: [
        {key: 'other', repos: [{nameWithOwner: 'a/b', nodeId: 'R_other'}]},
        {key: 'harness-tools', repos},
      ],
    })

    expect(parseBriefDomain(text, 'harness-tools').get('fro-bot/dashboard')).toBe('R_dash')
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '[]'],
    ['no domains list', '{}'],
    ['a domains list that is not a list', '{"domains": {}}'],
    ['no such domain', briefFile(repos, 'other')],
    ['a domain with no repos list', '{"domains": [{"key": "harness-tools"}]}'],
    ['a repo with no node ID', briefFile([{nameWithOwner: 'a/b', nodeId: ''}])],
    ['a repo that is not an object', '{"domains": [{"key": "harness-tools", "repos": ["a/b"]}]}'],
    [
      'a repo listed twice, in any case',
      briefFile([
        {nameWithOwner: 'a/b', nodeId: 'R_1'},
        {nameWithOwner: 'A/B', nodeId: 'R_2'},
      ]),
    ],
    ['an empty domain', briefFile([])],
  ])('fails with one fixed message for %s', (_name, text) => {
    expect(() => parseBriefDomain(text, 'harness-tools')).toThrow(new Error('the domain brief cannot be read'))
  })

  it('names no content in the message', () => {
    expect(() => parseBriefDomain('{"secret-token-value": ', 'harness-tools')).toThrow(
      new Error('the domain brief cannot be read'),
    )
  })
})

describe('checkBriefIdentity', () => {
  const ids = new Map([['fro-bot/dashboard', 'R_dash']])
  const check = (registry: GateEntry[], target: DispatchTarget = DASHBOARD) =>
    checkBriefIdentity({registry, target, programIds: ids})

  it('passes a target whose one row carries the program node ID', () => {
    expect(check([row(DASHBOARD, 'R_dash')])).toBeNull()
  })

  it('matches the name ignoring case', () => {
    expect(check([row({owner: 'Fro-Bot', name: 'Dashboard'}, 'R_dash')])).toBeNull()
  })

  it('refuses a target the domain does not list at that commit', () => {
    const other = {owner: 'fro-bot', name: 'agent'}

    expect(check([row(other, 'R_agent')], other)).toBe('brief-identity-mismatch')
  })

  it('refuses a target with no registry row', () => {
    expect(check([row({owner: 'fro-bot', name: 'agent'}, 'R_agent')])).toBe('brief-identity-mismatch')
  })

  it('refuses a row whose node ID differs, as a repository reached by a renamed name does', () => {
    expect(check([row(DASHBOARD, 'R_someone_else')])).toBe('brief-identity-mismatch')
  })

  it.each([undefined, ''])('refuses a row whose node ID is %j', nodeId => {
    expect(check([row(DASHBOARD, nodeId)])).toBe('brief-identity-mismatch')
  })

  it('refuses a name that resolves to two rows, whatever their node IDs', () => {
    expect(check([row(DASHBOARD, 'R_dash'), row(DASHBOARD, 'R_dash')])).toBe('brief-identity-ambiguous')
    expect(check([row(DASHBOARD, 'R_dash'), row({owner: 'FRO-BOT', name: 'Dashboard'}, 'R_x')])).toBe(
      'brief-identity-ambiguous',
    )
  })

  it('refuses a node ID that another row also carries', () => {
    expect(check([row(DASHBOARD, 'R_dash'), row({owner: 'fro-bot', name: 'old-dashboard'}, 'R_dash')])).toBe(
      'brief-identity-ambiguous',
    )
  })

  it('ignores rows of other repositories with other node IDs', () => {
    expect(check([row({owner: 'fro-bot', name: 'agent'}, 'R_agent'), row(DASHBOARD, 'R_dash')])).toBeNull()
  })
})

describe('an item may carry a gate reason', () => {
  const body = (item: Record<string, unknown>): unknown => ({
    goal: 'g',
    items: [{id: 'item-1', target: {owner: 'a', name: 'b'}, promptHash: 'h', status: 'blocked', ...item}],
  })

  it.each(['brief-unreadable', 'brief-identity-mismatch', 'brief-identity-ambiguous'])('accepts %s', reason => {
    expect(isGoalStateBody(body({gateReason: reason}))).toBe(true)
  })

  it('accepts a marker item written before the field existed', () => {
    expect(isGoalStateBody(body({}))).toBe(true)
  })

  it.each(['declined', 'other', '', 3])('rejects %j', reason => {
    expect(isGoalStateBody(body({gateReason: reason}))).toBe(false)
  })
})

/** The items of the last state marker written to the goal's comments. */
function items(comments: readonly MockComment[]): DispatchItem[] {
  return comments.map(comment => extractMarker(comment.body)).findLast(found => found !== null)?.state.items ?? []
}

describe('runDispatch: a goal whose item carries a domain brief reference', () => {
  const nodeIds = [{nameWithOwner: 'fro-bot/dashboard', nodeId: 'R_dash'}]
  const goal = () => pendingGoal(DASHBOARD, BRIEF_LINE())

  it('dispatches when the one registry row carries the program node ID, reading the brief at the pinned commit once', async () => {
    const loadBriefFile = vi.fn(async (_repo: unknown, _commit: string) => briefFile(nodeIds))

    const result = await dispatch({
      comments: goal().comments,
      registry: [row(DASHBOARD, 'R_dash')],
      extra: {loadBriefFile},
    })

    expect(result.counts).toMatchObject({dispatched: 1, blocked: 0})
    expect(result.dispatched).toHaveLength(1)
    expect(loadBriefFile).toHaveBeenCalledTimes(1)
    expect(loadBriefFile).toHaveBeenCalledWith(REPO, COMMIT)
  })

  it('reads one brief for two items that name the same commit', async () => {
    const second = {owner: 'fro-bot', name: 'agent'}
    const checklist = [
      '<!-- fro-bot:cross-repo-items:start -->',
      `- [ ] fro-bot/dashboard: ${BRIEF_LINE()}`,
      `- [ ] fro-bot/agent: ${BRIEF_LINE()}`,
      '<!-- fro-bot:cross-repo-items:end -->',
    ].join('\n')
    const parsed = parseDecomposition(checklist)
    const comments = [
      {id: 1, body: checklist, login: 'fro-bot'},
      {id: 2, body: buildMarkerComment({goal: 'goal-1', items: parsed.items, markerHash: ''}), login: 'fro-bot'},
    ]
    const loadBriefFile = vi.fn(async () =>
      briefFile([...nodeIds, {nameWithOwner: 'fro-bot/agent', nodeId: 'R_agent'}]),
    )

    const result = await dispatch({
      comments,
      registry: [row(DASHBOARD, 'R_dash'), row(second, 'R_agent')],
      extra: {loadBriefFile},
    })

    expect(result.counts.dispatched).toBe(2)
    expect(loadBriefFile).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a registry row with another node ID', [row(DASHBOARD, 'R_other')], 'brief-identity-mismatch'],
    ['a registry row with no node ID', [row(DASHBOARD, undefined)], 'brief-identity-mismatch'],
    [
      'two registry rows for the name',
      [row(DASHBOARD, 'R_dash'), row(DASHBOARD, 'R_dash')],
      'brief-identity-ambiguous',
    ],
  ])(
    'blocks the item and dispatches nothing for %s, with a fixed reason in the marker',
    async (_name, registry, reason) => {
      const result = await dispatch({
        comments: goal().comments,
        registry,
        extra: {loadBriefFile: async () => briefFile(nodeIds)},
      })

      expect(result.counts).toMatchObject({dispatched: 0, blocked: 1})
      expect(result.dispatched).toStrictEqual([])
      expect(items(result.comments)[0]).toMatchObject({status: 'blocked', gateReason: reason})
    },
  )

  it('blocks an item the domain does not list at the pinned commit', async () => {
    const result = await dispatch({
      comments: goal().comments,
      registry: [row(DASHBOARD, 'R_dash')],
      extra: {loadBriefFile: async () => briefFile([{nameWithOwner: 'fro-bot/agent', nodeId: 'R_agent'}])},
    })

    expect(result.dispatched).toStrictEqual([])
    expect(items(result.comments)[0]).toMatchObject({status: 'blocked', gateReason: 'brief-identity-mismatch'})
  })

  it.each([
    ['the read fails', async () => Promise.reject(new Error('503 secret detail'))],
    ['the file is not a brief', async () => 'not json'],
    ['the domain is missing', async () => briefFile(nodeIds, 'other-domain')],
  ])('blocks the item as unreadable when %s', async (_name, loadBriefFile) => {
    const result = await dispatch({
      comments: goal().comments,
      registry: [row(DASHBOARD, 'R_dash')],
      extra: {loadBriefFile},
    })

    expect(result.dispatched).toStrictEqual([])
    expect(items(result.comments)[0]).toMatchObject({status: 'blocked', gateReason: 'brief-unreadable'})
    expect(JSON.stringify(items(result.comments))).not.toContain('secret')
  })

  it('blocks the item as unreadable when the run has no way to read a brief', async () => {
    const result = await dispatch({comments: goal().comments, registry: [row(DASHBOARD, 'R_dash')]})

    expect(result.dispatched).toStrictEqual([])
    expect(items(result.comments)[0]).toMatchObject({status: 'blocked', gateReason: 'brief-unreadable'})
  })

  it('blocks an item whose reference is half written', async () => {
    const half = pendingGoal(DASHBOARD, 'Do it. Brief: program-domains.json@abc#harness-tools.')
    const loadBriefFile = vi.fn(async () => briefFile(nodeIds))

    const result = await dispatch({
      comments: half.comments,
      registry: [row(DASHBOARD, 'R_dash')],
      extra: {loadBriefFile},
    })

    expect(result.dispatched).toStrictEqual([])
    expect(items(result.comments)[0]).toMatchObject({status: 'blocked', gateReason: 'brief-unreadable'})
    expect(loadBriefFile).not.toHaveBeenCalled()
  })

  it('reads no brief for a target the registry gate already refuses', async () => {
    const loadBriefFile = vi.fn(async () => briefFile(nodeIds))

    const result = await dispatch({
      comments: goal().comments,
      registry: [row(DASHBOARD, 'R_dash', {private: true})],
      extra: {loadBriefFile},
    })

    expect(result.counts).toMatchObject({dispatched: 0, blocked: 1})
    expect(loadBriefFile).not.toHaveBeenCalled()
    expect(items(result.comments)[0]).not.toHaveProperty('gateReason')
  })

  it('leaves another item of the same goal to dispatch', async () => {
    const agent = {owner: 'fro-bot', name: 'agent'}
    const checklist = [
      '<!-- fro-bot:cross-repo-items:start -->',
      `- [ ] fro-bot/dashboard: ${BRIEF_LINE()}`,
      '- [ ] fro-bot/agent: Update the agent docs',
      '<!-- fro-bot:cross-repo-items:end -->',
    ].join('\n')
    const parsed = parseDecomposition(checklist)
    const comments = [
      {id: 1, body: checklist, login: 'fro-bot'},
      {id: 2, body: buildMarkerComment({goal: 'goal-1', items: parsed.items, markerHash: ''}), login: 'fro-bot'},
    ]

    const result = await dispatch({
      comments,
      registry: [row(DASHBOARD, 'R_other'), row(agent, 'R_agent')],
      extra: {loadBriefFile: async () => briefFile(nodeIds)},
    })

    expect(result.dispatched.map(call => call.repo)).toStrictEqual(['agent'])
    expect(result.counts).toMatchObject({dispatched: 1, blocked: 1})
  })
})

function clientWith(getContent: (params: unknown) => Promise<unknown>): CrossRepoDispatchOctokitClient {
  return {rest: {...mockOctokit([]).rest, repos: {getContent: getContent as never}}}
}

describe('loadBriefFile', () => {
  const file = (text: string, changes: Record<string, unknown> = {}) => ({
    data: {type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'), ...changes},
  })

  it('reads program-domains.json of the repository at the pinned commit and decodes it', async () => {
    const getContent = vi.fn(async () => file('{"domains": []}'))

    const text = await loadBriefFile(clientWith(getContent), REPO, COMMIT)

    expect(text).toBe('{"domains": []}')
    expect(getContent).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      path: 'program-domains.json',
      ref: COMMIT,
    })
  })

  it.each([
    ['a directory listing', {data: []}],
    ['a file that is not base64', file('x', {encoding: 'none'})],
    ['a file with no content', file('x', {content: undefined})],
    ['a symlink', file('x', {type: 'symlink'})],
    ['no data', {}],
  ])('fails for %s', async (_name, answer) => {
    await expect(
      loadBriefFile(
        clientWith(async () => answer),
        REPO,
        COMMIT,
      ),
    ).rejects.toThrow('the domain brief cannot be read')
  })

  it('fails when the client has no contents API', async () => {
    await expect(loadBriefFile(mockOctokit([]), REPO, COMMIT)).rejects.toThrow('the domain brief cannot be read')
  })

  it('fails with the fixed message when the read itself fails, naming nothing of the failure', async () => {
    await expect(
      loadBriefFile(
        clientWith(async () => Promise.reject(new Error('secret token detail'))),
        REPO,
        COMMIT,
      ),
    ).rejects.toThrow(new Error('the domain brief cannot be read'))
  })
})
