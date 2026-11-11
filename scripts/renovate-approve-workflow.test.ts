import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Contract test for the Renovate approver's workflow. The approver holds FRO_BOT_PAT and approves PRs, so the
// shape that keeps PR-controlled code and PR-controlled values out of it is pinned here: a change that adds
// a PR trigger, moves the secret out of the sweep step, reads an event field or keys the concurrency group
// on the payload fails this file first.

interface Step {
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
  id?: string
  if?: string
  'continue-on-error'?: boolean
}

interface Job {
  name?: string
  if?: string
  needs?: unknown
  env?: unknown
  permissions?: Record<string, string>
  'timeout-minutes'?: number
  steps: Step[]
}

interface Workflow {
  name: string
  on: Record<string, unknown>
  permissions?: Record<string, string>
  env?: unknown
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  jobs: Record<string, Job>
}

function assertWorkflow(value: unknown): asserts value is Workflow {
  if (typeof value !== 'object' || value === null) throw new TypeError('renovate-approve.yaml has no shape')
  const record = value as Record<string, unknown>
  if (typeof record.on !== 'object' || record.on === null || typeof record.jobs !== 'object' || record.jobs === null) {
    throw new TypeError('renovate-approve.yaml does not have the expected shape')
  }
}

const expressionStart = '$' + '{{'
const root = resolve(import.meta.dirname, '..')
const raw = readFileSync(resolve(root, '.github/workflows/renovate-approve.yaml'), 'utf8')
const parsed: unknown = parse(raw)
assertWorkflow(parsed)
const workflow = parsed
const job = workflow.jobs.approve
if (job === undefined) throw new TypeError('renovate-approve.yaml must define the approve job')
const steps = job.steps
const sweepStep = steps.at(-1)
const serialized = JSON.stringify(workflow)

describe('renovate-approve.yaml triggers', () => {
  it('is named Renovate Approve and has exactly workflow_run, schedule and workflow_dispatch', () => {
    expect(workflow.name).toBe('Renovate Approve')
    expect(Object.keys(workflow.on).toSorted()).toEqual(['schedule', 'workflow_dispatch', 'workflow_run'])
  })

  it('has no trigger that runs a PR’s workflow definition or reacts to a push', () => {
    for (const forbidden of ['pull_request', 'pull_request_target', 'push', 'issue_comment', 'repository_dispatch']) {
      expect(workflow.on).not.toHaveProperty(forbidden)
    }
  })

  it('starts on the completion of the workflows that produce a required check, and nothing else', () => {
    const run = workflow.on.workflow_run as {workflows?: string[]; types?: string[]}
    expect(run.types).toEqual(['completed'])
    expect(run.workflows).toEqual(['Main', 'CodeQL', 'Dependency Review', 'Renovate', 'Check Private Leak'])
  })

  it('names workflows that exist on this branch, so a rename cannot silently unhook the trigger', () => {
    const run = workflow.on.workflow_run as {workflows: string[]}
    const names = [
      'main.yaml',
      'codeql-analysis.yaml',
      'dependency-review.yaml',
      'renovate.yaml',
      'check-private-leak.yaml',
    ].map(file => {
      const document: unknown = parse(readFileSync(resolve(root, '.github/workflows', file), 'utf8'))
      return (document as {name: string}).name
    })
    expect(run.workflows).toEqual(names)
  })

  it('sweeps on a schedule every 30 minutes, at minutes that are not the top or bottom of the hour', () => {
    const schedule = workflow.on.schedule as {cron: string}[]
    expect(schedule).toHaveLength(1)
    const [minutes, ...rest] = (schedule[0]?.cron ?? '').split(' ')
    expect(rest).toEqual(['*', '*', '*', '*'])
    const [first, second] = (minutes ?? '').split(',').map(Number)
    expect(second).toBe((first ?? 0) + 30)
    expect(first).toBeLessThan(30)
    expect([0, 30]).not.toContain(first)
    expect([0, 30]).not.toContain(second)
  })

  it('can be dispatched by hand, with no inputs', () => {
    expect(workflow.on.workflow_dispatch === null || workflow.on.workflow_dispatch === undefined).toBe(true)
    expect('workflow_dispatch' in workflow.on).toBe(true)
  })
})

describe('renovate-approve.yaml runs trusted code only', () => {
  it('has one job, gated on the default branch', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['approve'])
    expect(job.if).toBe("github.ref == 'refs/heads/main'")
    expect(job.needs).toBeUndefined()
  })

  it('checks out without a ref, without persisting credentials, as its first step', () => {
    const checkout = steps[0]
    expect(checkout?.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/u)
    expect(checkout?.with).toEqual({'persist-credentials': false})
  })

  it('runs the shared setup action after the checkout and before the sweep', () => {
    const checkout = steps.findIndex(step => step.uses?.startsWith('actions/checkout@') === true)
    const setup = steps.findIndex(step => step.uses === './.github/actions/setup')
    const sweep = steps.findIndex(step => step.run?.includes('scripts/renovate-approve.ts') === true)
    expect(checkout).toBe(0)
    expect(setup).toBe(1)
    expect(sweep).toBe(2)
    expect(steps).toHaveLength(3)
  })

  it('uses nothing but the checkout, the setup action and the sweep: no artifact, no token mint, no settings write', () => {
    expect(steps.map(step => step.uses ?? step.run)).toEqual([
      steps[0]?.uses,
      './.github/actions/setup',
      'bun scripts/renovate-approve.ts',
    ])
    expect(serialized).not.toMatch(/download-artifact|upload-artifact|create-github-app-token|get-workflow-app-token/u)
    expect(serialized).not.toMatch(/update-repo-settings|settings\.yml|repos\.update|branches\/main\/protection/u)
  })

  it('reads no event field and no PR-controlled context', () => {
    expect(serialized).not.toContain('github.event')
    expect(serialized).not.toContain('workflow_run.')
    expect(serialized).not.toContain('github.head_ref')
    expect(serialized).not.toContain('pull_requests')
    // the only expressions are the job gate (a ref), the secret and the variable
    const expressions = [...raw.replaceAll(/#.*$/gmu, '').matchAll(/\$\{\{[^}]*\}\}/gu)].map(match => match[0])
    expect(expressions.toSorted()).toEqual(
      [`${expressionStart} secrets.FRO_BOT_PAT }}`, `${expressionStart} vars.RENOVATE_APPROVE }}`].toSorted(),
    )
  })

  it('puts no expression inside a run script', () => {
    for (const step of steps) expect(step.run ?? '').not.toContain(expressionStart)
  })

  it('reads contents only, at the workflow and nowhere else', () => {
    expect(workflow.permissions).toEqual({contents: 'read'})
    expect(job.permissions).toBeUndefined()
  })

  it('gives the job 30 minutes: setup, the sweep’s 10-minute budget and its 2-minute reconcile, with room to spare', () => {
    expect(job['timeout-minutes']).toBe(30)
  })
})

describe('renovate-approve.yaml holds the PAT in one step', () => {
  it('gives FRO_BOT_PAT and the variable to the sweep step alone, as step env (R11)', () => {
    const holders = steps.filter(step => JSON.stringify(step).includes('FRO_BOT_PAT'))
    expect(holders).toHaveLength(1)
    expect(holders[0]).toBe(sweepStep)
    expect(sweepStep?.run).toBe('bun scripts/renovate-approve.ts')
    expect(sweepStep?.env).toEqual({
      GH_TOKEN: `${expressionStart} secrets.FRO_BOT_PAT }}`,
      RENOVATE_APPROVE: `${expressionStart} vars.RENOVATE_APPROVE }}`,
    })
    expect(sweepStep?.if).toBeUndefined()
    expect(sweepStep?.['continue-on-error']).toBeUndefined()
    expect(sweepStep?.uses).toBeUndefined()
  })

  it('has the secret and the variable once each in the file, and no workflow-level or job-level env', () => {
    expect(workflow).not.toHaveProperty('env')
    expect(job).not.toHaveProperty('env')
    expect(raw.match(/secrets\.FRO_BOT_PAT/gu)).toHaveLength(1)
    expect(raw.match(/vars\.RENOVATE_APPROVE/gu)).toHaveLength(1)
    expect(raw).not.toMatch(/secrets\.(?!FRO_BOT_PAT)/u)
    expect(raw).not.toContain('secrets: inherit')
  })

  it('keeps the PAT out of every git subprocess and every action input', () => {
    for (const step of steps.filter(candidate => candidate.uses !== undefined)) {
      expect(JSON.stringify(step.with ?? {})).not.toContain('FRO_BOT_PAT')
      expect(step.env).toBeUndefined()
    }
  })
})

describe('renovate-approve.yaml serializes the sweeps', () => {
  it('uses one fixed concurrency group that never cancels a run in flight', () => {
    expect(workflow.concurrency).toEqual({group: 'renovate-approve', 'cancel-in-progress': false})
    expect(workflow.concurrency?.group).not.toContain('$')
  })
})

describe('the hold-merge label covers the approver', () => {
  it('describes the hold for the promotion step and the Renovate approver, within 100 characters (R12)', () => {
    const settings = parse(readFileSync(resolve(root, '.github/settings.yml'), 'utf8')) as {
      labels: {name: string; description?: string}[]
    }
    const label = settings.labels.find(candidate => candidate.name === 'hold-merge')
    expect(label?.description).toContain('promotion self-merge')
    expect(label?.description).toContain('Renovate approver')
    expect((label?.description ?? '').length).toBeLessThanOrEqual(100)
  })
})
