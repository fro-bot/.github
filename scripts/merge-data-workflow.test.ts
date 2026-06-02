import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Regression guard: the privacy gate (check-wiki-private-presence.ts) must
// run BEFORE the promotion-PR step (merge-data-pr.ts). A refactor that
// reorders steps would silently break the gate without this test.

describe('merge-data.yaml workflow step order', () => {
  // #given the merge-data workflow file parsed as a YAML document
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/merge-data.yaml')
  const workflow = parse(readFileSync(workflowPath, 'utf8')) as {
    jobs: Record<string, {steps: {name?: string; run?: string}[]}>
  }
  const steps = workflow.jobs['merge-data']?.steps ?? []

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
})
