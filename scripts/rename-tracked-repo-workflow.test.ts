import {readFile} from 'node:fs/promises'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Contract for `.github/workflows/rename-tracked-repo.yaml`: the operator rename is inert until
// dispatched, runs no agent, hands the write token to exactly one step, and takes its inputs
// through env only.

interface Step {
  id?: string
  name?: string
  uses?: string
  if?: string
  run?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface Workflow {
  on?: {workflow_dispatch?: {inputs?: Record<string, {required?: boolean; type?: string; default?: unknown}>}} & Record<
    string,
    unknown
  >
  permissions?: unknown
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  jobs?: Record<string, {steps?: Step[]; permissions?: unknown; 'timeout-minutes'?: number}>
}

const gh = (inner: string): string => `$${'{{'} ${inner} }}`

async function loadWorkflow(): Promise<Workflow> {
  const raw: unknown = parse(await readFile('.github/workflows/rename-tracked-repo.yaml', 'utf8'))
  return raw as Workflow
}

async function loadSteps(): Promise<Step[]> {
  const workflow = await loadWorkflow()
  const jobs = Object.values(workflow.jobs ?? {})
  expect(jobs).toHaveLength(1)
  return jobs[0]?.steps ?? []
}

const stringsIn = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(item => stringsIn(item))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [key, ...stringsIn(item)])
  }
  return []
}

describe('rename-tracked-repo.yaml workflow contract', () => {
  it('is dispatch-only with a required node_id and an optional old_name', async () => {
    const workflow = await loadWorkflow()

    expect(Object.keys(workflow.on ?? {})).toEqual(['workflow_dispatch'])
    const inputs = workflow.on?.workflow_dispatch?.inputs ?? {}
    expect(Object.keys(inputs)).toEqual(['node_id', 'old_name'])
    expect(inputs.node_id).toMatchObject({required: true, type: 'string'})
    expect(inputs.old_name).toMatchObject({required: false, type: 'string'})
  })

  it('grants no workflow-level permissions and serializes runs without cancelling a write', async () => {
    const workflow = await loadWorkflow()

    expect(workflow.permissions).toEqual({})
    expect(workflow.concurrency).toEqual({group: 'rename-tracked-repo', 'cancel-in-progress': false})
    const job = Object.values(workflow.jobs ?? {})[0]
    expect(job).not.toHaveProperty('permissions')
    expect(job?.['timeout-minutes']).toBeLessThanOrEqual(10)
  })

  it('checks out without persisting credentials, then runs the shared setup action', async () => {
    const steps = await loadSteps()

    const checkoutIndex = steps.findIndex(step => step.uses?.startsWith('actions/checkout@'))
    const setupIndex = steps.findIndex(step => step.uses === './.github/actions/setup')
    expect(checkoutIndex).toBe(0)
    expect(steps[checkoutIndex]?.with?.['persist-credentials']).toBe(false)
    expect(setupIndex).toBeGreaterThan(checkoutIndex)
  })

  it('runs no agent step', async () => {
    const steps = await loadSteps()

    for (const step of steps) {
      expect(step.uses ?? '').not.toMatch(/agent|opencode|copilot|claude/iu)
      expect(Object.keys(step.env ?? {}).join(' ')).not.toMatch(/OPENCODE|ANTHROPIC|OPENAI|GITHUB_PAT|POLL_PAT/u)
    }
  })

  it('mints a contents:write App token for this repository only, and nothing wider', async () => {
    const steps = await loadSteps()
    const mint = steps.find(step => step.id === 'writer-token')

    expect(mint?.uses).toMatch(/^actions\/create-github-app-token@[0-9a-f]{40}/u)
    expect(mint?.with?.repositories).toBe(gh('github.event.repository.name'))
    expect(mint?.with).not.toHaveProperty('owner')
    const permissions = Object.entries(mint?.with ?? {}).filter(([name]) => name.startsWith('permission-'))
    expect(permissions).toStrictEqual([['permission-contents', 'write']])
  })

  it('passes the writer token to exactly one step, the rename step, and to nothing else', async () => {
    const steps = await loadSteps()
    const consumers = steps.filter(
      step => step.id !== 'writer-token' && stringsIn(step).some(text => text.includes('writer-token')),
    )

    expect(consumers).toHaveLength(1)
    expect(consumers[0]?.env?.RENAME_WRITER_TOKEN).toBe(gh('steps.writer-token.outputs.token'))
    expect(consumers[0]?.run).toBe('node scripts/rename-tracked-repo.ts')
  })

  it('feeds the evidence reads the unprivileged workflow token, never the App token or a PAT', async () => {
    const steps = await loadSteps()
    const rename = steps.find(step => step.run === 'node scripts/rename-tracked-repo.ts')

    expect(rename?.env?.GITHUB_TOKEN).toBe(gh('github.token'))
    expect(stringsIn(steps).join('\n')).not.toMatch(/secrets\.(?!APPLICATION_ID|APPLICATION_PRIVATE_KEY)/u)
  })

  it('takes its inputs through env only, never interpolated into a command', async () => {
    const steps = await loadSteps()
    const rename = steps.find(step => step.run === 'node scripts/rename-tracked-repo.ts')

    expect(rename?.env?.NODE_ID).toBe(gh('inputs.node_id'))
    expect(rename?.env?.OLD_NAME).toBe(gh('inputs.old_name'))
    for (const step of steps) expect(step.run ?? '').not.toContain('${{')
  })

  it('has exactly four steps in a fixed order: checkout, setup, mint, rename', async () => {
    const steps = await loadSteps()

    expect(steps.map(step => step.id ?? step.uses?.split('@')[0] ?? 'run')).toEqual([
      'actions/checkout',
      './.github/actions/setup',
      'writer-token',
      'run',
    ])
  })
})
