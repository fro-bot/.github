import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {evaluateExpression} from '@fro-bot/test-kit/workflow-expression'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface MentionWorkflow {
  on: Record<string, {types?: string[]}>
  permissions?: Record<string, string>
  jobs: Record<
    string,
    {
      if?: string
      permissions?: Record<string, string>
      steps?: {name?: string; uses?: string; run?: string; env?: Record<string, string>}[]
    }
  >
}

const workflow = parse(
  readFileSync(resolve(import.meta.dirname, '../.github/workflows/rollout-tracker-mention.yaml'), 'utf8'),
) as MentionWorkflow
const job = workflow.jobs['dispatch-tracker']
const step = job?.steps?.find(candidate => candidate.name === 'Dispatch the tracker run')
const script = String(step?.run ?? '')

function commentEvent(fixture: {issueNumber: number; pullRequest?: boolean; login: string; body: string}): unknown {
  return {
    github: {
      event: {
        issue: {number: fixture.issueNumber, pull_request: fixture.pullRequest === true ? {url: 'pr'} : null},
        comment: {body: fixture.body, user: {login: fixture.login}},
      },
    },
  }
}

describe('rollout-tracker-mention.yaml: the dispatch step', () => {
  it('dispatches the tracker with a numeric comment id', () => {
    const run = runStepWithStubs(script, {env: {COMMENT_ID: '4301234567'}, stubTools: ['gh']})

    expect(run.status).toBe(0)
    expect(run.trace).toEqual(['gh workflow run gateway-rollout-tracker.yaml --ref main -f comment_id=4301234567'])
  })

  it.each(['', 'abc', '12 34', '12\n34', '12;echo pwned', '$(id)', '-1', '12\n'])(
    'fails before gh runs for the comment id %j',
    commentId => {
      const run = runStepWithStubs(script, {env: {COMMENT_ID: commentId}, stubTools: ['gh']})

      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('comment id shape invalid')
      expect(run.trace.filter(line => line.startsWith('gh '))).toEqual([])
    },
  )

  it('takes its token, repository and comment id from the event, not from the comment text', () => {
    const expressionStart = '$' + '{{'

    expect(step?.env).toEqual({
      GH_TOKEN: `${expressionStart} github.token }}`,
      GH_REPO: `${expressionStart} github.repository }}`,
      COMMENT_ID: `${expressionStart} github.event.comment.id }}`,
    })
    expect(script).not.toContain('github.event.comment.body')
  })
})

describe('rollout-tracker-mention.yaml: the job gate', () => {
  const gate = String(job?.if ?? '')

  it.each([
    [
      'an operator mention on #3512',
      {issueNumber: 3512, login: 'marcusrbrown', body: '@fro-bot gateway v0.125.2 is live'},
      true,
    ],
    ['a mention anywhere in the body', {issueNumber: 3512, login: 'marcusrbrown', body: 'ping\n\n@fro-bot ?'}, true],
    ['an operator mention on another issue', {issueNumber: 3511, login: 'marcusrbrown', body: '@fro-bot hi'}, false],
    [
      'an operator mention on pull request 3512',
      {issueNumber: 3512, pullRequest: true, login: 'marcusrbrown', body: '@fro-bot hi'},
      false,
    ],
    ['another author mentioning on #3512', {issueNumber: 3512, login: 'octocat', body: '@fro-bot hi'}, false],
    ['the fro-bot account on #3512', {issueNumber: 3512, login: 'fro-bot', body: '@fro-bot hi'}, false],
    [
      'an operator comment without a mention',
      {issueNumber: 3512, login: 'marcusrbrown', body: 'acceptance green'},
      false,
    ],
  ])('evaluates the gate against a fixture: %s', (_name, fixture, expected) => {
    expect(evaluateExpression(gate, commentEvent(fixture))).toBe(expected)
  })

  it('pins the issue number, the author login, the mention check and the pull request exclusion', () => {
    expect(gate).toContain('github.event.issue.number == 3512')
    expect(gate).toContain('github.event.issue.pull_request == null')
    expect(gate).toContain("github.event.comment.user.login == 'marcusrbrown'")
    expect(gate).toContain("contains(github.event.comment.body || '', '@fro-bot')")
  })
})

describe('rollout-tracker-mention.yaml: privilege shape', () => {
  it('triggers only on created issue comments', () => {
    expect(Object.keys(workflow.on)).toEqual(['issue_comment'])
    expect(workflow.on.issue_comment?.types).toEqual(['created'])
  })

  it('grants nothing at workflow level and exactly actions: write to the job', () => {
    expect(workflow.permissions).toEqual({})
    expect(job?.permissions).toEqual({actions: 'write'})
  })

  it('has a single step and no checkout, action or mint', () => {
    expect(job?.steps).toHaveLength(1)
    expect(job?.steps?.some(candidate => candidate.uses !== undefined)).toBe(false)
  })
})
