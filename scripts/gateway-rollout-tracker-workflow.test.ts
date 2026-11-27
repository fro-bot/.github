import {createHash} from 'node:crypto'
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
  if?: string
  'continue-on-error'?: boolean
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
    expect(checkout?.uses).toMatch(/^actions\/checkout@[\da-f]{40}$/u)
    expect(checkout?.with?.['persist-credentials']).toBe(false)
    expect(workflowText).toMatch(/^\s*uses: actions\/checkout@[\da-f]{40} # v\d+\.\d+\.\d+$/mu)
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

  it('succeeds as a no-op, with one fixed line, when every program has been closed out', () => {
    const run = fan([])

    expect(run.status).toBe(0)
    expect(dispatched(run)).toEqual([])
    expect(run.stdout.trim().split('\n')).toEqual([
      '::notice::program-trackers.json lists no program; nothing to dispatch',
    ])
    expect(run.stderr).toBe('')
  })

  it('fails on a config that has no programs array at all', () => {
    const run = runStepWithStubs(`printf '{}' > program-trackers.json\n${fanOutScript}`, {
      stubTools: ['gh'],
      env: {GH_REPO: 'fro-bot/.github'},
    })

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

  it('rereads the default-branch config before filing in each repo', () => {
    const flat = String(update?.with?.prompt ?? '').replaceAll(/\s+/g, ' ')

    expect(flat).toContain('Before you file in each repo, reread program-trackers.json from the default branch')
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
      ['bootstrap_repos', '.bootstrap_repos'],
      ['bootstrap_blocked', '.bootstrap_blocked'],
      ['public_items', '.public_items'],
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

describe('gateway-rollout-tracker.yaml: the prompt of a program with no domain', () => {
  // Every expression of the prompt, answered the way a #3512 run would answer it. An expression the
  // prompt gains that this table lacks fails the render, so a new one cannot slip in unseen.
  const answers: Record<string, string> = {
    'needs.preflight.outputs.program': 'gateway',
    'needs.preflight.outputs.tracker_issue': 'fro-bot/.github#3512',
    'needs.preflight.outputs.tracker_repo': 'fro-bot/.github',
    'needs.preflight.outputs.project_url': 'https://github.com/users/fro-bot/projects/1',
    'needs.preflight.outputs.operator_login': 'marcusrbrown',
    'needs.preflight.outputs.evidence': 'gateway',
    'needs.preflight.outputs.pending_mention_ids': '[101,104]',
    'needs.preflight.outputs.reason': 'operator mention pending (2)',
    'needs.preflight.outputs.operator_comment_ids': '[101,103,104]',
    'needs.preflight.outputs.public_items': '[]',
    'needs.preflight.outputs.bootstrap_repos': '[]',
    'needs.preflight.outputs.bootstrap_blocked': '[]',
    'needs.preflight.outputs.marker_comment_id': '100',
    'needs.preflight.outputs.marker': '<!-- gateway-rollout-tracker:{"hash":"abc","last_mention_id":104} -->',
    'inputs.comment_id': '104',
    // A program with no domain has no domain duty: the preflight prints no domain and the output is empty.
    'needs.preflight.outputs.domain_bootstrap': '',
    // Nor a goal duty: the output is empty, and the expression sits flush against the bootstrap one, so it adds no byte.
    'needs.preflight.outputs.domain_goals': '',
    // Nor an answer duty: the output is empty and flush against the goal one, so it adds no byte either.
    'needs.preflight.outputs.domain_answers': '',
  }

  function render(prompt: string): string {
    return prompt.replaceAll(/\$\{\{ ([^ }]+) \}\}/g, (_whole, expression: string) => {
      const answer = answers[expression]
      if (answer === undefined)
        throw new Error(`the prompt has an expression the render does not answer: ${expression}`)
      return answer
    })
  }

  it('renders byte for byte as it did before the domain duty existed', () => {
    const rendered = render(String(update?.with?.prompt ?? ''))

    expect(createHash('sha256').update(rendered).digest('hex')).toBe(
      '6e94a8b65ed058e2760a590c3496aee90100a3aebd2a34ea4b467114224693d2',
    )
  })
})

describe('gateway-rollout-tracker.yaml: the domain bootstrap duty', () => {
  const snapshot = (preflight?.steps ?? []).find(step => step.id === 'snapshot')
  const script = String(snapshot?.run ?? '')
  const prompt = String(update?.with?.prompt ?? '')

  const result = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      should_comment: true,
      reason: 'cold start',
      pending_mention_ids: [],
      marker: '<!-- gateway-rollout-tracker:{} -->',
      marker_comment_id: null,
      operator_comment_ids: [],
      bootstrap_repos: [],
      bootstrap_blocked: [],
      public_items: [],
      program: {
        key: 'harness',
        issue: 'fro-bot/.github#5000',
        repo: 'fro-bot/.github',
        project_url: 'https://github.com/users/fro-bot/projects/9',
        operator_login: 'marcusrbrown',
        evidence: 'none',
      },
      ...extra,
    })

  function runSnapshot(json: string): ReturnType<typeof runStepWithStubs> {
    return runStepWithStubs(`bun() { printf '%s' "$FAKE_RESULT"; }\n${script}`, {env: {FAKE_RESULT: json}})
  }

  it('exposes the domain instructions as a job output', () => {
    expect(preflight?.outputs?.domain_bootstrap).toBe(expr('steps.snapshot.outputs.domain_bootstrap'))
    expect(script).toContain('.domain.bootstrap_instructions')
  })

  it('writes the instructions to the step output whole, leading blank lines and all', () => {
    const text = '\n\nDomain program. Line one.\nLine two "quoted" and $dollar.'

    const run = runSnapshot(result({domain: {bootstrap_instructions: text}}))

    expect(run.status).toBe(0)
    expect(run.outputs.domain_bootstrap).toBe(text)
    expect(run.outputs.program).toBe('harness')
  })

  it('writes an empty output for a program with no domain', () => {
    const run = runSnapshot(result())

    expect(run.status).toBe(0)
    expect(run.outputs.domain_bootstrap).toBe('')
    expect(run.outputs.bootstrap_repos).toBe('[]')
  })

  it('places the instructions right after the bootstrap duty, before the blocked repos', () => {
    const flat = prompt.replaceAll(/\s+/g, ' ')
    const placeholder = expr('needs.preflight.outputs.domain_bootstrap')

    expect(flat).toContain(
      `Report a filing failure only for a repo that is still public.${placeholder}${expr('needs.preflight.outputs.domain_goals')}${expr('needs.preflight.outputs.domain_answers')} Blocked repos.`,
    )
    expect(prompt.split(placeholder)).toHaveLength(2)
  })

  describe('the brief commit', () => {
    const commit = String(snapshot?.env?.ROLLOUT_TRACKER_BRIEF_COMMIT ?? '')
    const inner = /\$\{\{([\s\S]*)\}\}/.exec(commit)?.[1] ?? ''
    const sha = 'f'.repeat(40)

    it('is the commit of a run on main', () => {
      expect(evaluateExpressionValue(inner, {github: {ref: 'refs/heads/main', sha}})).toBe(sha)
    })

    it.each(['refs/heads/feature', 'refs/tags/v1', ''])(
      'is empty for a run on %j, so no brief is pinned to it',
      ref => {
        expect(evaluateExpressionValue(inner, {github: {ref, sha}})).toBe('')
      },
    )

    it('names the repository the brief lives in', () => {
      expect(snapshot?.env?.ROLLOUT_TRACKER_BRIEF_REPO).toBe(expr('github.repository'))
    })
  })
})

describe('gateway-rollout-tracker.yaml: the domain goal duty', () => {
  const snapshot = (preflight?.steps ?? []).find(step => step.id === 'snapshot')
  const script = String(snapshot?.run ?? '')
  const prompt = String(update?.with?.prompt ?? '')
  const placeholder = expr('needs.preflight.outputs.domain_goals')

  const result = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      should_comment: true,
      reason: 'goal batches',
      pending_mention_ids: [],
      marker: '<!-- gateway-rollout-tracker:{} -->',
      marker_comment_id: null,
      operator_comment_ids: [],
      bootstrap_repos: [],
      bootstrap_blocked: [],
      public_items: [],
      program: {
        key: 'harness',
        issue: 'fro-bot/.github#5000',
        repo: 'fro-bot/.github',
        project_url: 'https://github.com/users/fro-bot/projects/9',
        operator_login: 'marcusrbrown',
        evidence: 'none',
      },
      ...extra,
    })

  function runSnapshot(json: string): ReturnType<typeof runStepWithStubs> {
    return runStepWithStubs(`bun() { printf '%s' "$FAKE_RESULT"; }\n${script}`, {env: {FAKE_RESULT: json}})
  }

  it('exposes the goal instructions as a job output', () => {
    expect(preflight?.outputs?.domain_goals).toBe(expr('steps.snapshot.outputs.domain_goals'))
    expect(script).toContain('.domain.goal_instructions')
  })

  it('writes the instructions to the step output whole, leading blank lines, JSON and all', () => {
    const text = '\n\nGoals. Line one.\n[{"title":"A \\"quoted\\" $dollar"}]\nLine three.'

    const run = runSnapshot(result({domain: {bootstrap_instructions: '', goal_instructions: text}}))

    expect(run.status).toBe(0)
    expect(run.outputs.domain_goals).toBe(text)
    expect(run.outputs.domain_bootstrap).toBe('')
  })

  it('writes an empty output for a program with no domain, and for a domain with no goal duty', () => {
    expect(runSnapshot(result()).outputs.domain_goals).toBe('')
    expect(runSnapshot(result({domain: {bootstrap_instructions: 'x'}})).outputs.domain_goals).toBe('')
  })

  it('places the instructions flush after the bootstrap instructions, once, with no static goal text of its own', () => {
    expect(prompt.split(placeholder)).toHaveLength(2)
    expect(prompt).not.toContain('cross-repo-goal')
    expect(prompt).not.toContain('dispatch-approved')
  })
})

describe('gateway-rollout-tracker.yaml: the domain answer duty', () => {
  const snapshot = (preflight?.steps ?? []).find(step => step.id === 'snapshot')
  const script = String(snapshot?.run ?? '')
  const prompt = String(update?.with?.prompt ?? '')
  const placeholder = expr('needs.preflight.outputs.domain_answers')

  const result = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      should_comment: true,
      reason: 'domain attention changed',
      pending_mention_ids: [],
      marker: '<!-- gateway-rollout-tracker:{} -->',
      marker_comment_id: null,
      operator_comment_ids: [],
      bootstrap_repos: [],
      bootstrap_blocked: [],
      public_items: [],
      program: {
        key: 'harness',
        issue: 'fro-bot/.github#5000',
        repo: 'fro-bot/.github',
        project_url: 'https://github.com/users/fro-bot/projects/9',
        operator_login: 'marcusrbrown',
        evidence: 'none',
      },
      ...extra,
    })

  function runSnapshot(json: string): ReturnType<typeof runStepWithStubs> {
    return runStepWithStubs(`bun() { printf '%s' "$FAKE_RESULT"; }\n${script}`, {env: {FAKE_RESULT: json}})
  }

  it('exposes the answer instructions as a job output, read from the preflight result', () => {
    expect(preflight?.outputs?.domain_answers).toBe(expr('steps.snapshot.outputs.domain_answers'))
    expect(script).toContain('.domain.answer_instructions')
  })

  it('writes the instructions to the step output whole, leading blank lines, JSON, parity comment and all', () => {
    const text = '\n\nAnswers. Line one.\n[{"comment":"A \\"quoted\\" $dollar\\n<!-- marker -->"}]\nLine three.'

    const run = runSnapshot(
      result({domain: {bootstrap_instructions: '', goal_instructions: '', answer_instructions: text}}),
    )

    expect(run.status).toBe(0)
    expect(run.outputs.domain_answers).toBe(text)
    expect(run.outputs.domain_goals).toBe('')
    expect(run.outputs.domain_bootstrap).toBe('')
  })

  it('writes an empty output for a program with no domain, and for a domain with no answer duty', () => {
    expect(runSnapshot(result()).outputs.domain_answers).toBe('')
    expect(runSnapshot(result({domain: {bootstrap_instructions: 'x'}})).outputs.domain_answers).toBe('')
  })

  it('hands a cleared attention state to a step of its own, and writes nothing when there is none', () => {
    const update = {comment_id: 77, body: 'Parts\n<!-- gateway-rollout-tracker:{"hash":"h"} -->\n'}

    const run = runSnapshot(result({domain: {marker_update: update}}))
    const none = runSnapshot(result({domain: {marker_update: null}}))

    expect(run.outputs.marker_update_id).toBe('77')
    expect(run.outputs.marker_update_body).toBe(update.body.trimEnd())
    expect(none.outputs.marker_update_id).toBe('')
    expect(runSnapshot(result()).outputs.marker_update_id).toBe('')
    expect(preflight?.steps?.map(step => step.name)).toContain('Record a cleared attention state')
  })

  describe('the step that records a cleared attention state', () => {
    const recorder = (preflight?.steps ?? []).find(step => step.name === 'Record a cleared attention state')
    const body = String(recorder?.run ?? '')

    it('runs only when the preflight has an update, with the PAT and the values through env', () => {
      expect(recorder?.if).toBe("steps.snapshot.outputs.marker_update_id != ''")
      expect(recorder?.env?.GH_TOKEN).toBe(expr('secrets.FRO_BOT_PAT'))
      expect(recorder?.env?.COMMENT_ID).toBe(expr('steps.snapshot.outputs.marker_update_id'))
      expect(recorder?.env?.COMMENT_BODY).toBe(expr('steps.snapshot.outputs.marker_update_body'))
      expect(recorder?.env?.TRACKER_REPO).toBe(expr('steps.snapshot.outputs.tracker_repo'))
      expect(body).not.toContain(expressionStart)
    })

    it('edits that one comment in place and nothing else', () => {
      const run = runStepWithStubs(body, {
        stubTools: ['gh'],
        env: {COMMENT_ID: '77', COMMENT_BODY: 'text <!-- m -->', TRACKER_REPO: 'fro-bot/.github'},
      })

      expect(run.status).toBe(0)
      expect(run.trace).toEqual(['gh api -X PATCH repos/fro-bot/.github/issues/comments/77 -f body=text <!-- m -->'])
    })

    it('refuses an id that is not a number', () => {
      const run = runStepWithStubs(body, {
        stubTools: ['gh'],
        env: {COMMENT_ID: '7; rm', COMMENT_BODY: 'x', TRACKER_REPO: 'fro-bot/.github'},
      })

      expect(run.status).not.toBe(0)
      expect(run.trace).toEqual([])
    })
  })

  it('places the instructions flush after the goal instructions, once, with no static answer text of its own', () => {
    expect(prompt.split(placeholder)).toHaveLength(2)
    expect(prompt).toContain(`${expr('needs.preflight.outputs.domain_goals')}${placeholder}`)
    for (const text of ['part-accepted', 'part-declined', 'part-countered', 'parity-follows', 'stalled', 'held']) {
      expect(prompt).not.toContain(text)
    }
  })
})

describe('gateway-rollout-tracker.yaml: a goal the tracker just created may be linked', () => {
  const prompt = String(update?.with?.prompt ?? '')
  const flat = prompt.replaceAll(/\s+/g, ' ')
  const goalsOutput = expr('needs.preflight.outputs.domain_goals')

  it('keeps the public item allowlist as it was, so the rendered prompt of a program with no domain is unchanged', () => {
    expect(flat).toContain('A Project item outside that set stays out of everything you write')
    expect(flat).not.toContain('Exception')
  })

  it("delivers the exception with the goals duty: after the allowlist, and only in a domain program's prompt", () => {
    expect(flat.indexOf(goalsOutput)).toBeGreaterThan(flat.indexOf('Public item set.'))
    expect(prompt.split(goalsOutput)).toHaveLength(2)
  })
})
