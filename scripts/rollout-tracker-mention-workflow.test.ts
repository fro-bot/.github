import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {evaluateExpression} from '@fro-bot/test-kit/workflow-expression'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {afterAll, describe, expect, it} from 'vitest'
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

const scratch = mkdtempSync(join(tmpdir(), 'rollout-tracker-mention-'))
afterAll(() => {
  rmSync(scratch, {recursive: true, force: true})
})

let fileCounter = 0
function configFile(programs: readonly unknown[]): string {
  fileCounter += 1
  const path = join(scratch, `config-${fileCounter}.json`)
  writeFileSync(path, JSON.stringify({programs}))
  return path
}

const gateway = {
  key: 'gateway',
  issue: 'fro-bot/.github#3512',
  project: {owner: 'fro-bot', number: 1, gateField: 'gateway Unit Gate'},
  operator: {id: 831617, login: 'marcusrbrown'},
  evidence: 'gateway',
}
const plugins = {
  key: 'opencode-v2',
  issue: 'fro-bot/.github#4200',
  project: {owner: 'marcusrbrown', number: 9, gateField: 'Gate'},
  operator: {id: 5, login: 'someone'},
  evidence: 'none',
}

/** A `gh` that answers `gh api` from a config file (or fails) and logs everything else to the stub trace. */
const GH_FUNCTION = [
  'gh() {',
  '  echo "gh $*" >> "$STUB_TRACE"',
  '  if [ "$1" = api ]; then',
  '    if [ -n "$FAKE_API_FAIL" ]; then echo "gh: HTTP 502" >&2; return 1; fi',
  '    cat "$FAKE_CONFIG_FILE"',
  '    return 0',
  '  fi',
  '  if [ -n "$FAKE_RUN_FAIL" ]; then return 1; fi',
  '  return 0',
  '}',
  '',
].join('\n')

interface RelayInput {
  commentId?: string
  userId?: string
  issueNumber?: string
  event?: string
  config?: readonly unknown[]
  apiFail?: boolean
  runFail?: boolean
}

function relay(input: RelayInput = {}): ReturnType<typeof runStepWithStubs> {
  return runStepWithStubs(GH_FUNCTION + script, {
    stubTools: ['gh'],
    env: {
      GH_REPO: 'fro-bot/.github',
      COMMENT_ID: input.commentId ?? '4301234567',
      COMMENT_USER_ID: input.userId ?? '831617',
      ISSUE_NUMBER: input.issueNumber ?? '3512',
      COMMENT_EVENT: input.event ?? 'created',
      FAKE_CONFIG_FILE: configFile(input.config ?? [gateway]),
      FAKE_API_FAIL: input.apiFail === true ? '1' : '',
      FAKE_RUN_FAIL: input.runFail === true ? '1' : '',
    },
  })
}

function dispatches(run: ReturnType<typeof runStepWithStubs>): string[] {
  return run.trace.filter(line => line.startsWith('gh workflow run'))
}

function commentEvent(fixture: {
  action?: string
  issueNumber?: number
  pullRequest?: boolean
  login?: string
  body?: string
}): unknown {
  return {
    github: {
      event: {
        action: fixture.action ?? 'created',
        issue: {number: fixture.issueNumber ?? 3512, pull_request: fixture.pullRequest === true ? {url: 'pr'} : null},
        comment: {body: fixture.body ?? '', user: {login: fixture.login ?? 'marcusrbrown'}},
      },
    },
  }
}

describe('rollout-tracker-mention.yaml: the dispatch step', () => {
  it('dispatches the program with the comment id and the event kind', () => {
    const run = relay()

    expect(run.status).toBe(0)
    expect(dispatches(run)).toEqual([
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=gateway -f comment_id=4301234567 -f comment_event=created',
    ])
  })

  it('reads the program config from the default branch through the contents API', () => {
    const run = relay()

    expect(run.trace[0]).toBe(
      'gh api -H Accept: application/vnd.github.raw repos/fro-bot/.github/contents/program-trackers.json',
    )
  })

  it('dispatches an operator edit with the edited event kind', () => {
    const run = relay({event: 'edited', commentId: '4725610605'})

    expect(run.status).toBe(0)
    expect(dispatches(run)).toEqual([
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=gateway -f comment_id=4725610605 -f comment_event=edited',
    ])
  })

  it('picks the program whose issue and operator both match', () => {
    const run = relay({issueNumber: '4200', userId: '5', config: [gateway, plugins]})

    expect(dispatches(run)).toEqual([
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=opencode-v2 -f comment_id=4301234567 -f comment_event=created',
    ])
  })

  it('compares the issue with the repository ignoring case', () => {
    const run = relay({config: [{...gateway, issue: 'FRO-BOT/.GitHub#3512'}]})

    expect(dispatches(run)).toHaveLength(1)
  })

  it.each([
    ['another user on a configured issue', {userId: '999'}],
    ['the operator of a different program on this issue', {userId: '5', config: [gateway, plugins]}],
    ['the operator on an unconfigured issue', {issueNumber: '9999'}],
    ['the operator on an issue that only shares a prefix', {issueNumber: '35120'}],
    ['a user id that only shares a prefix with the operator', {userId: '8316170'}],
  ])('does not dispatch for %s, and exits 0', (_name, input: RelayInput) => {
    const run = relay(input)

    expect(run.status).toBe(0)
    expect(dispatches(run)).toEqual([])
  })

  it('fails visibly, with nothing dispatched, when the config read fails', () => {
    const run = relay({apiFail: true})

    expect(run.status).not.toBe(0)
    expect(dispatches(run)).toEqual([])
  })

  it('fails visibly when the config is malformed', () => {
    const path = join(scratch, 'malformed.json')
    writeFileSync(path, '{')
    const run = runStepWithStubs(GH_FUNCTION + script, {
      stubTools: ['gh'],
      env: {
        GH_REPO: 'fro-bot/.github',
        COMMENT_ID: '1',
        COMMENT_USER_ID: '831617',
        ISSUE_NUMBER: '3512',
        COMMENT_EVENT: 'created',
        FAKE_CONFIG_FILE: path,
        FAKE_API_FAIL: '',
        FAKE_RUN_FAIL: '',
      },
    })

    expect(run.status).not.toBe(0)
    expect(dispatches(run)).toEqual([])
  })

  it('fails when the dispatch itself fails', () => {
    const run = relay({runFail: true})

    expect(run.status).not.toBe(0)
  })

  it.each(['', 'abc', '12 34', '12\n34', '12;echo pwned', '$(id)', '-1', '12\n'])(
    'fails before gh runs for the comment id %j',
    commentId => {
      const run = relay({commentId})

      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('comment id shape invalid')
      expect(run.trace.filter(line => line.startsWith('gh '))).toEqual([])
    },
  )

  it.each(['', 'abc', '12;id', '-1', '1\n2'])('fails before gh runs for the comment user id %j', userId => {
    const run = relay({userId})

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('comment user id shape invalid')
    expect(run.trace.filter(line => line.startsWith('gh '))).toEqual([])
  })

  it.each(['', 'abc', '12;id', '-1', '1\n2'])('fails before gh runs for the issue number %j', issueNumber => {
    const run = relay({issueNumber})

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('issue number shape invalid')
    expect(run.trace.filter(line => line.startsWith('gh '))).toEqual([])
  })

  it.each(['', 'deleted', 'CREATED', 'created;id', 'edited\nx'])(
    'fails before gh runs for the comment event %j',
    event => {
      const run = relay({event})

      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('comment event invalid')
      expect(run.trace.filter(line => line.startsWith('gh '))).toEqual([])
    },
  )

  it('refuses a program key that is not a plain key, even from the config', () => {
    const run = relay({config: [{...gateway, key: 'x; rm -rf /'}]})

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('program key shape invalid')
    expect(dispatches(run)).toEqual([])
  })

  it('takes every value from the event through env, never from the comment text', () => {
    const expressionStart = '$' + '{{'

    expect(step?.env).toEqual({
      GH_TOKEN: `${expressionStart} github.token }}`,
      GH_REPO: `${expressionStart} github.repository }}`,
      COMMENT_ID: `${expressionStart} github.event.comment.id }}`,
      COMMENT_USER_ID: `${expressionStart} github.event.comment.user.id }}`,
      ISSUE_NUMBER: `${expressionStart} github.event.issue.number }}`,
      COMMENT_EVENT: `${expressionStart} github.event.action }}`,
    })
    expect(script).not.toContain('github.event.comment.body')
    expect(script).not.toContain(expressionStart)
  })
})

describe('rollout-tracker-mention.yaml: the job gate', () => {
  const gate = String(job?.if ?? '')

  it.each([
    ['an operator mention on an issue', {body: '@fro-bot gateway v0.125.2 is live'}, true],
    ['a mention anywhere in the body', {body: 'ping\n\n@fro-bot ?'}, true],
    ['a created comment without a mention', {body: 'acceptance green'}, false],
    ['an edit without a mention', {action: 'edited', body: 'G4c pass'}, true],
    ['an edit with a mention', {action: 'edited', body: '@fro-bot G4c pass'}, true],
    ['an edit with an empty body', {action: 'edited', body: ''}, true],
    ['a comment on a pull request', {pullRequest: true, body: '@fro-bot hi'}, false],
    ['an edit on a pull request', {pullRequest: true, action: 'edited', body: 'x'}, false],
    [
      'a mention on any other issue number (the step checks the config)',
      {issueNumber: 4200, body: '@fro-bot hi'},
      true,
    ],
  ])('evaluates the gate against a fixture: %s', (_name, fixture, expected) => {
    expect(evaluateExpression(gate, commentEvent(fixture))).toBe(expected)
  })

  it('does not name an issue number or an operator: the config decides', () => {
    expect(gate).not.toMatch(/\d{3,}/)
    expect(gate).not.toContain('marcusrbrown')
    expect(gate).toContain('github.event.issue.pull_request == null')
    expect(gate).toContain("github.event.action == 'edited'")
    expect(gate).toContain("contains(github.event.comment.body || '', '@fro-bot')")
  })
})

describe('rollout-tracker-mention.yaml: privilege shape', () => {
  it('triggers on created and edited issue comments', () => {
    expect(Object.keys(workflow.on)).toEqual(['issue_comment'])
    expect(workflow.on.issue_comment?.types).toEqual(['created', 'edited'])
  })

  it('grants nothing at workflow level and exactly contents: read and actions: write to the job', () => {
    expect(workflow.permissions).toEqual({})
    expect(job?.permissions).toEqual({contents: 'read', actions: 'write'})
  })

  it('has a single step and no checkout, action or mint', () => {
    expect(job?.steps).toHaveLength(1)
    expect(job?.steps?.some(candidate => candidate.uses !== undefined)).toBe(false)
  })
})

describe('rollout-tracker-mention.yaml: operator login case and closed-out programs', () => {
  it('dispatches by numeric user id, whatever case the configured login has', () => {
    const run = relay({config: [{...gateway, operator: {id: 831617, login: 'MarcusRBrown'}}]})

    expect(run.status).toBe(0)
    expect(dispatches(run)).toEqual([
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=gateway -f comment_id=4301234567 -f comment_event=created',
    ])
  })

  it('dispatches nothing, and exits 0, when no program is configured', () => {
    const run = relay({config: []})

    expect(run.status).toBe(0)
    expect(dispatches(run)).toEqual([])
  })
})
