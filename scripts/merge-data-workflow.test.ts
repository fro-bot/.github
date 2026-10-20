import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Regression guard: the privacy gate (check-wiki-private-presence.ts) must
// run BEFORE the promotion-PR step (merge-data-pr.ts). A refactor that
// reorders steps would silently break the gate without this test.

/** Narrow the parsed YAML to the shape we index into, without any broad cast. */
function assertMergeDataWorkflow(value: unknown): asserts value is {
  on: {
    push?: {branches?: string[]}
    repository_dispatch?: {types?: string[]}
    schedule?: {cron?: string}[]
    workflow_dispatch?: unknown
  }
  permissions?: Record<string, string>
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean | string}
  jobs: Record<
    string,
    {
      steps: {
        name?: string
        run?: string
        uses?: string
        with?: Record<string, unknown>
        env?: Record<string, string>
        id?: string
        'continue-on-error'?: boolean
        if?: string
      }[]
    }
  >
} {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('merge-data.yaml does not have expected shape: missing workflow contract objects')
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.on !== 'object' ||
    record.on === null ||
    Array.isArray(record.on) ||
    typeof record.permissions !== 'object' ||
    record.permissions === null ||
    Array.isArray(record.permissions) ||
    typeof record.concurrency !== 'object' ||
    record.concurrency === null ||
    Array.isArray(record.concurrency) ||
    typeof record.jobs !== 'object' ||
    record.jobs === null ||
    Array.isArray(record.jobs)
  ) {
    throw new TypeError('merge-data.yaml does not have expected shape: missing workflow contract objects')
  }
}

describe('merge-data.yaml workflow step order', () => {
  // #given the merge-data workflow file parsed as a YAML document
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/merge-data.yaml')
  const workflowRaw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(workflowRaw)
  assertMergeDataWorkflow(parsed)
  const steps = parsed.jobs['merge-data']?.steps ?? []

  it('contains the privacy gate step (check-wiki-private-presence.ts)', () => {
    // #when searching for the gate step
    // #then it must exist (guards against a silent rename breaking the assertion)
    const gateStep = steps.find(s => s.run?.includes('check-wiki-private-presence.ts'))
    expect(gateStep).toBeDefined()
  })

  it('contains the merge PR step (merge-data-pr.ts)', () => {
    // #when searching for the promotion step
    // #then it must exist (guards against a silent rename breaking the assertion)
    const mergeStep = steps.find(s => s.run?.includes('merge-data-pr.ts'))
    expect(mergeStep).toBeDefined()
  })

  it('runs the privacy gate before the promotion PR step', () => {
    // #given the indices of both steps
    const gateIndex = steps.findIndex(s => s.run?.includes('check-wiki-private-presence.ts'))
    const mergeIndex = steps.findIndex(s => s.run?.includes('merge-data-pr.ts'))

    // #when comparing positions
    // #then the gate must precede the merge (lower index = earlier in execution)
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(mergeIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeLessThan(mergeIndex)
  })

  it('privacy gate step does not have continue-on-error or if: that could neuter it', () => {
    // #given the gate step
    const gateStep = steps.find(s => s.run?.includes('check-wiki-private-presence.ts'))
    expect(gateStep).toBeDefined()
    // #then continue-on-error must be absent or falsy — it would let the gate fail silently
    expect(gateStep?.['continue-on-error']).toBeFalsy()
    // #then if: must be absent — a conditional skip would allow the gate to be bypassed
    expect(gateStep?.if).toBeUndefined()
  })

  it('triggers on the explicit promotion dispatch alongside the weekly schedule and manual dispatch', () => {
    expect(parsed.on.push).toBeUndefined()
    expect(parsed.on.repository_dispatch?.types).toEqual(['promote-data'])
    expect(parsed.on.schedule).toEqual([{cron: '0 22 * * 0'}])
    expect(parsed.on).toHaveProperty('workflow_dispatch')
  })

  it('keeps least-privilege top-level permissions unchanged', () => {
    expect(parsed.permissions).toEqual({contents: 'read'})
  })

  it('uses trigger-discriminated concurrency with dispatch-only cancellation', () => {
    const expressionStart = '$' + '{{'
    expect(parsed.concurrency?.group).toBe(
      `merge-data-${expressionStart} github.event_name == 'repository_dispatch' && 'dispatch' || 'manual' }}`,
    )
    expect(parsed.concurrency?.['cancel-in-progress']).toBe(
      `${expressionStart} github.event_name == 'repository_dispatch' }}`,
    )
  })

  it('pins the first checkout to main rather than inheriting github.ref', () => {
    const checkoutStep = steps.find(step => step.uses?.startsWith('actions/checkout@'))
    expect(checkoutStep?.with?.ref).toBe('main')
  })

  it('does not reference repository_dispatch client payload data', () => {
    expect(workflowRaw).not.toContain('client_payload')
  })

  it('runs the merge-back after Setup and before the data checkout, the gates and the promotion PR', () => {
    // #given the step positions
    const indexOf = (predicate: (step: (typeof steps)[number]) => boolean): number => steps.findIndex(predicate)
    const mergeBack = indexOf(step => step.run?.includes('merge-back-data.ts') === true)
    const setup = indexOf(step => step.uses === './.github/actions/setup')
    const dataCheckout = indexOf(
      step => step.uses?.startsWith('actions/checkout@') === true && step.with?.ref === 'data',
    )
    const presenceGate = indexOf(step => step.run?.includes('check-wiki-private-presence.ts') === true)
    const fetchRef = indexOf(step => step.run?.includes('git fetch') === true && step.run.includes('data'))
    const promotionGate = indexOf(step => step.run?.includes('check-private-leak.ts --promotion') === true)
    const promotion = indexOf(step => step.run?.includes('merge-data-pr.ts') === true)

    // #then every step exists, and the merge-back sits strictly between Setup and everything that reads data
    for (const position of [mergeBack, setup, dataCheckout, presenceGate, fetchRef, promotionGate, promotion]) {
      expect(position).toBeGreaterThanOrEqual(0)
    }
    expect(setup).toBeLessThan(mergeBack)
    expect(mergeBack).toBeLessThan(dataCheckout)
    expect(mergeBack).toBeLessThan(presenceGate)
    expect(mergeBack).toBeLessThan(fetchRef)
    expect(mergeBack).toBeLessThan(promotionGate)
    expect(mergeBack).toBeLessThan(promotion)
  })

  it('gives the merge-back the App token, runs it with bun, and lets nothing neuter it', () => {
    const mergeBack = steps.find(step => step.run?.includes('merge-back-data.ts'))
    const tokenStep = steps.find(step => step.id === 'get-workflow-app-token')

    expect(tokenStep).toBeDefined()
    expect(mergeBack?.run).toBe('bun scripts/merge-back-data.ts')
    expect(mergeBack?.env).toEqual({GITHUB_TOKEN: '$' + '{{ steps.get-workflow-app-token.outputs.token }}'})
    // a failure must fail the job: no continue-on-error, no conditional skip
    expect(mergeBack?.['continue-on-error']).toBeUndefined()
    expect(mergeBack?.if).toBeUndefined()
  })

  it('preserves the existing gate and promotion step ordering', () => {
    expect(steps.map(step => step.name)).toEqual([
      'Get Workflow Access Token',
      '⤵ Checkout Branch',
      '📦 Setup',
      '🔁 Merge main into data',
      '⤵ Fetch data branch for privacy check',
      '🔒 Block private wiki pages',
      '🔒 Fetch data ref for promotion diff',
      '🔒 Block private repo names in promotion diff',
      '🔀 Open data merge PR',
    ])
  })
})
