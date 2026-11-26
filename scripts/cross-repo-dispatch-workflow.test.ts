import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {afterEach, describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface Step {
  name?: string
  id?: string
  if?: string
  'continue-on-error'?: boolean
  run?: string
}

interface Job {
  steps: Step[]
}

const workflow = parse(
  readFileSync(new URL('../.github/workflows/cross-repo-dispatch.yaml', import.meta.url), 'utf8'),
) as {
  jobs: Record<string, Job>
}

const HELD_MESSAGE = 'brief read failed; remove and reapply dispatch-approved to retry'

const dispatchJob = workflow.jobs.dispatch as Job
const trackJob = workflow.jobs.track as Job
const stepNamed = (job: Job, name: RegExp): Step => {
  const step = job.steps.find(candidate => name.test(candidate.name ?? ''))
  if (step === undefined) throw new TypeError(`no step matches ${name.source}`)
  return step
}

let directory = ''

afterEach(() => {
  if (directory !== '') rmSync(directory, {recursive: true, force: true})
  directory = ''
})

/** Run a summary step's script with `jq` real, the result file as the job wrote it, and the summary file read back. */
function summaryOf(step: Step, result: unknown): string {
  directory = mkdtempSync(join(tmpdir(), 'dispatch-summary-'))
  const resultPath = join(directory, 'result.json')
  const summaryPath = join(directory, 'summary.md')
  writeFileSync(resultPath, JSON.stringify(result))
  writeFileSync(summaryPath, '')
  const run = runStepWithStubs(String(step.run ?? ''), {
    env: {CROSS_REPO_DISPATCH_RESULT_PATH: resultPath, GITHUB_STEP_SUMMARY: summaryPath},
  })
  expect(run.status).toBe(0)
  return readFileSync(summaryPath, 'utf8')
}

describe('cross-repo-dispatch.yaml: a held dispatch is visible', () => {
  const dispatchStep = stepNamed(dispatchJob, /Dispatch approved goal items/)
  const dispatchSummary = stepNamed(dispatchJob, /Write dispatch summary/)
  const trackSummary = stepNamed(trackJob, /Write track summary/)

  it('lets the dispatch step fail the job: no continue-on-error, so a held item turns the run red', () => {
    expect(dispatchStep['continue-on-error']).toBeUndefined()
    expect(String(dispatchStep.run)).toContain('bun scripts/cross-repo-dispatch.ts dispatch')
  })

  it('still writes the summary after a failed dispatch step', () => {
    expect(dispatchSummary.if).toBe('always()')
    expect(trackSummary.if).toBe('always()')
  })

  it('shows the held count and the fixed instruction in the dispatch summary when an item is held', () => {
    const summary = summaryOf(dispatchSummary, {counts: {dispatched: 0, held: 1}})

    expect(summary).toContain('| Held (brief read failed) | 1 |')
    expect(summary).toContain(HELD_MESSAGE)
  })

  it('shows a zero count and no instruction in the dispatch summary when nothing is held', () => {
    const summary = summaryOf(dispatchSummary, {counts: {dispatched: 1}})

    expect(summary).toContain('| Held (brief read failed) | 0 |')
    expect(summary).not.toContain(HELD_MESSAGE)
  })

  it('shows the held count and the same instruction in the track summary, and nothing extra otherwise', () => {
    const held = summaryOf(trackSummary, {counts: {itemsHeld: 2}})
    const none = summaryOf(trackSummary, {counts: {itemsHeld: 0}})

    expect(held).toContain('| Items held (brief read failed) | 2 |')
    expect(held).toContain(HELD_MESSAGE)
    expect(none).toContain('| Items held (brief read failed) | 0 |')
    expect(none).not.toContain(HELD_MESSAGE)
  })

  it('keeps the unavailable-result line when there is no result file', () => {
    directory = mkdtempSync(join(tmpdir(), 'dispatch-summary-'))
    const summaryPath = join(directory, 'summary.md')
    writeFileSync(summaryPath, '')

    runStepWithStubs(String(dispatchSummary.run), {
      env: {CROSS_REPO_DISPATCH_RESULT_PATH: join(directory, 'missing.json'), GITHUB_STEP_SUMMARY: summaryPath},
    })

    expect(readFileSync(summaryPath, 'utf8')).toContain('(dispatch result unavailable)')
  })
})
