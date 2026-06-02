import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Regression guard: the privacy gate (check-wiki-private-presence.ts) must
// run BEFORE the promotion-PR step (merge-data-pr.ts). A refactor that
// reorders steps would silently break the gate without this test.

/** Narrow the parsed YAML to the shape we index into, without any broad cast. */
function assertMergeDataWorkflow(value: unknown): asserts value is {
  jobs: Record<string, {steps: {name?: string; run?: string; 'continue-on-error'?: boolean; if?: string}[]}>
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('merge-data.yaml does not have expected shape: missing jobs object')
  }
}

describe('merge-data.yaml workflow step order', () => {
  // #given the merge-data workflow file parsed as a YAML document
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/merge-data.yaml')
  const parsed: unknown = parse(readFileSync(workflowPath, 'utf8'))
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
})
