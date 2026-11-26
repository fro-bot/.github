import type {
  CrossRepoDispatchOctokitClient,
  DispatchItem,
  DispatchTarget,
  GateEntry,
  GoalState,
} from './dispatch-model.ts'
import {describe, expect, it, vi} from 'vitest'
import {buildMarkerComment} from './dispatch-marker.ts'
import {REQUIRED_APPROVER} from './dispatch-model.ts'
import {parseDecomposition} from './dispatch-receipts.ts'
import {runDispatch} from './dispatch-run.ts'

const REPO = {owner: 'fro-bot', repo: '.github'}
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
