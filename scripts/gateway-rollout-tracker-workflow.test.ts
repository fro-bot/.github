import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {evaluateExpression, evaluateExpressionValue} from '@fro-bot/test-kit/workflow-expression'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface Step {
  name?: string
  id?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
}

interface Job {
  if?: string
  needs?: string | string[]
  uses?: string
  permissions?: Record<string, string>
  outputs?: Record<string, string>
  with?: Record<string, unknown>
  steps?: Step[]
}

interface TrackerWorkflow {
  on: {
    schedule?: {cron: string}[]
    push?: {branches?: string[]; paths?: string[]}
    workflow_dispatch?: {inputs?: Record<string, {type?: string; required?: boolean; default?: unknown}>}
  }
  permissions?: Record<string, string>
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  jobs: Record<string, Job>
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/gateway-rollout-tracker.yaml')
const workflowText = readFileSync(workflowPath, 'utf8')
const workflow = parse(workflowText) as TrackerWorkflow
const expressionStart = '$' + '{{'
const expr = (expression: string): string => `${expressionStart} ${expression} }}`

const programs = workflow.jobs.programs
const preflight = workflow.jobs.preflight
const update = workflow.jobs['update-rollout-tracker']
const fanOut = programs?.steps?.find(step => step.name === 'Dispatch the tracker for every program')
const fanOutScript = String(fanOut?.run ?? '')

describe('gateway-rollout-tracker.yaml: triggers and concurrency', () => {
  it('keeps the daily schedule and adds a push trigger on the program config only', () => {
    expect(workflow.on.schedule).toEqual([{cron: '0 6 * * *'}])
    expect(workflow.on.push).toEqual({branches: ['main'], paths: ['program-trackers.json']})
  })

  it('dispatches with a program, a comment id and a comment event', () => {
    const inputs = workflow.on.workflow_dispatch?.inputs ?? {}

    expect(Object.keys(inputs)).toEqual(['program', 'comment_id', 'comment_event'])
    expect(inputs.program).toMatchObject({type: 'string', required: false, default: 'gateway'})
    expect(inputs.comment_id).toMatchObject({type: 'string', required: false, default: ''})
    expect(inputs.comment_event).toMatchObject({type: 'string', required: false, default: ''})
  })

  it('serializes runs per program and never cancels a run in progress', () => {
    const group = String(workflow.concurrency?.group)
    const inner = /\$\{\{([\s\S]*)\}\}/.exec(group)?.[1] ?? ''

    expect(group.startsWith('program-tracker-')).toBe(true)
    expect(evaluateExpressionValue(inner, {inputs: {program: 'gateway'}})).toBe('gateway')
    expect(evaluateExpressionValue(inner, {inputs: {program: 'opencode-v2'}})).toBe('opencode-v2')
    expect(evaluateExpressionValue(inner, {inputs: {}})).toBe('fanout')
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false)
  })

  it('grants contents: read at the top, and nothing wider than the jobs need', () => {
    expect(workflow.permissions).toEqual({contents: 'read'})
    expect(programs?.permissions).toEqual({contents: 'read', actions: 'write'})
    expect(preflight?.permissions).toEqual({contents: 'read'})
  })
})

describe('gateway-rollout-tracker.yaml: which jobs run', () => {
  const programsIf = String(programs?.if ?? '')
  const preflightIf = String(preflight?.if ?? '')

  it.each([
    ['a scheduled run', 'schedule', true, false],
    ['a push that changes the config', 'push', true, false],
    ['a dispatched run', 'workflow_dispatch', false, true],
  ])('%s', (_name, eventName, fansOut, preflights) => {
    const context = {github: {event_name: eventName}}

    expect(evaluateExpression(programsIf, context)).toBe(fansOut)
    expect(evaluateExpression(preflightIf, context)).toBe(preflights)
  })

  it('runs the agent only after a successful preflight that reports a wake', () => {
    expect(update?.needs).toBe('preflight')
    const runs = (result: string, shouldComment: string): boolean =>
      evaluateExpression(String(update?.if), {
        needs: {preflight: {result, outputs: {should_comment: shouldComment}}},
      })

    expect(runs('success', 'true')).toBe(true)
    expect(runs('success', 'false')).toBe(false)
    expect(runs('skipped', 'true')).toBe(false)
    expect(runs('failure', 'true')).toBe(false)
  })

  it('calls fro-bot.yaml with the program as its concurrency key', () => {
    expect(update?.uses).toBe('./.github/workflows/fro-bot.yaml')
    expect(update?.with?.['concurrency-key']).toBe(`program-tracker-${expr('inputs.program')}`)
  })
})

describe('gateway-rollout-tracker.yaml: the fan-out job', () => {
  const checkout = programs?.steps?.find(step => step.uses?.startsWith('actions/checkout@'))

  it('checks out with the repository pin and keeps no credential', () => {
    expect(checkout?.uses).toBe('actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0')
    expect(checkout?.with?.['persist-credentials']).toBe(false)
    expect(workflowText).toContain('uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0')
  })

  it('dispatches with the workflow token, and reads every value through env', () => {
    expect(fanOut?.env).toEqual({GH_TOKEN: expr('github.token'), GH_REPO: expr('github.repository')})
    expect(fanOutScript).not.toContain(expressionStart)
  })

  const prefix = (programList: readonly unknown[]): string =>
    [
      `cat > program-trackers.json <<'CONFIG_EOF'`,
      JSON.stringify({programs: programList}),
      'CONFIG_EOF',
      'gh() {',
      '  echo "gh $*" >> "$STUB_TRACE"',
      '  case "$*" in *"program=$FAKE_FAIL_KEY"*) return 1 ;; esac',
      '  return 0',
      '}',
      '',
    ].join('\n')
  const entry = (key: string): Record<string, unknown> => ({key})

  function fan(programList: readonly unknown[], failKey = '@@none@@'): ReturnType<typeof runStepWithStubs> {
    return runStepWithStubs(prefix(programList) + fanOutScript, {
      stubTools: ['gh'],
      env: {GH_REPO: 'fro-bot/.github', FAKE_FAIL_KEY: failKey},
    })
  }

  const dispatched = (run: ReturnType<typeof runStepWithStubs>): string[] =>
    run.trace.filter(line => line.startsWith('gh workflow run'))

  it('dispatches the tracker once for each program key, from the default branch', () => {
    const run = fan([entry('gateway'), entry('opencode-v2')])

    expect(run.status).toBe(0)
    expect(dispatched(run)).toEqual([
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=gateway',
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=opencode-v2',
    ])
  })

  it('does not stop at a failed dispatch, and fails the job after the rest have run', () => {
    const run = fan([entry('gateway'), entry('broken'), entry('opencode-v2')], 'broken')

    expect(dispatched(run)).toEqual([
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=gateway',
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=broken',
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=opencode-v2',
    ])
    expect(run.status).not.toBe(0)
    expect(run.stdout + run.stderr).toContain('1 of 3 dispatches failed')
  })

  it('skips a key that is not a plain program key, runs the others and fails the job', () => {
    const run = fan([entry('gateway'), entry('x; rm -rf /'), entry('opencode-v2')])

    expect(dispatched(run)).toEqual([
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=gateway',
      'gh workflow run gateway-rollout-tracker.yaml --ref main -f program=opencode-v2',
    ])
    expect(run.status).not.toBe(0)
  })

  it('fails when the config lists no program', () => {
    const run = fan([])

    expect(run.status).not.toBe(0)
    expect(dispatched(run)).toEqual([])
  })

  it('fails on a config that is not valid JSON', () => {
    const run = runStepWithStubs(`printf '{' > program-trackers.json\n${fanOutScript}`, {
      stubTools: ['gh'],
      env: {GH_REPO: 'fro-bot/.github'},
    })

    expect(run.status).not.toBe(0)
    expect(dispatched(run)).toEqual([])
  })
})

describe('gateway-rollout-tracker.yaml: the preflight job', () => {
  const steps = preflight?.steps ?? []
  const snapshot = steps.find(step => step.id === 'snapshot')
  const inputsStep = steps.find(step => step.name === 'Validate program and comment event')

  it('validates the comment id first, then the program and the comment event', () => {
    expect(steps[0]?.name).toBe('Validate comment ID')
    expect(steps[1]).toBe(inputsStep)
  })

  it('passes the program, the comment id and the comment event to the snapshot', () => {
    expect(snapshot?.env?.ROLLOUT_TRACKER_PROGRAM).toBe(expr('inputs.program'))
    expect(snapshot?.env?.ROLLOUT_TRACKER_COMMENT_ID).toBe(expr('inputs.comment_id'))
    expect(snapshot?.env?.ROLLOUT_TRACKER_COMMENT_EVENT).toBe(expr('inputs.comment_event'))
  })

  describe('input validation step', () => {
    const script = String(inputsStep?.run ?? '')
    const run = (program: string, event: string): ReturnType<typeof runStepWithStubs> =>
      runStepWithStubs(script, {env: {PROGRAM: program, COMMENT_EVENT: event}})

    it('takes its values through env', () => {
      expect(inputsStep?.env).toEqual({PROGRAM: expr('inputs.program'), COMMENT_EVENT: expr('inputs.comment_event')})
      expect(script).not.toContain(expressionStart)
    })

    it.each([
      ['gateway', ''],
      ['opencode-v2', 'created'],
      ['a1', 'edited'],
    ])('accepts program %j with event %j', (program, event) => {
      expect(run(program, event).status).toBe(0)
    })

    it.each(['', 'Gateway', '-x', 'a b', 'a;b', `${'$'}{{ x }}`, 'a\nb', 'a_b'])('rejects the program %j', program => {
      const result = run(program, '')

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('program must be a program key')
    })

    it.each(['edit', 'CREATED', 'created;id', 'x\ny', '1'])('rejects the comment event %j', event => {
      const result = run('gateway', event)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('comment_event must be created, edited or empty')
    })
  })

  it('reads the program block from the snapshot result into job outputs', () => {
    const run = String(snapshot?.run ?? '')

    for (const [output, field] of [
      ['program', '.program.key'],
      ['tracker_issue', '.program.issue'],
      ['tracker_repo', '.program.repo'],
      ['project_url', '.program.project_url'],
      ['operator_login', '.program.operator_login'],
      ['evidence', '.program.evidence'],
      ['operator_comment_ids', '.operator_comment_ids'],
    ] as const) {
      expect(preflight?.outputs?.[output]).toBe(expr(`steps.snapshot.outputs.${output}`))
      expect(run).toContain(field)
    }
  })
})

describe('gateway-rollout-tracker.yaml: nothing user-controlled in a script', () => {
  it('writes no expression inside any run block', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        expect(step.run ?? '').not.toContain(expressionStart)
      }
    }
  })
})

describe('gateway-rollout-tracker.yaml: the prompt is templated from the preflight', () => {
  const prompt = String(update?.with?.prompt ?? '')
  const flat = prompt.replaceAll(/\s+/g, ' ')

  it('names the tracker issue, the Project, the operator and the repository from preflight outputs', () => {
    for (const output of ['program', 'tracker_issue', 'tracker_repo', 'project_url', 'operator_login', 'evidence']) {
      expect(flat).toContain(expr(`needs.preflight.outputs.${output}`))
    }
  })

  it('hardcodes neither the gateway tracker nor its Project', () => {
    expect(flat).not.toContain('3512')
    expect(flat).not.toContain('projects/1')
    expect(flat).not.toContain('fro-bot/.github#')
    expect(flat).not.toContain('Project 1')
    expect(flat).not.toContain('marcusrbrown/projects')
  })

  it('reads the program skill by path before acting', () => {
    expect(flat).toContain('Read .agents/skills/cross-repo-program/SKILL.md before you act.')
  })

  it('limits the external evidence to programs whose evidence kind is gateway', () => {
    expect(flat).toContain('when the evidence kind is gateway')
  })
})
