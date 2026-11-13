import {readdirSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Contract: the three `Query wiki context` steps of fro-bot.yaml (the main job, Remediate and Observe) run the
// baseline wiki query through the stderr router, so the `page-skipped` and `baseline-` warnings reach the job
// summary, and no step runs the bare script. The router replays stderr unchanged and keeps the command's stdout,
// `GITHUB_OUTPUT` and exit code, which packages/wiki-ops/src/wiki-query-route.test.ts proves.

const WORKFLOWS = resolve(import.meta.dirname, '../.github/workflows')

const EXPECTED_RUN =
  "bun scripts/route-stderr.ts --route 'wiki-query:warn:page-skipped =Wiki pages skipped' --route 'wiki-query:warn:baseline-=Wiki context unavailable' --summary filtered bun scripts/wiki-query.ts"

const JOBS = ['fro-bot', 'fro-bot-remediate', 'fro-bot-observe'] as const

interface Step {
  id?: string
  name?: string
  run?: string
}
interface Workflow {
  jobs: Record<string, {steps?: Step[]}>
}

function load(file: string): Workflow {
  return parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as Workflow
}

describe('the baseline wiki query steps of fro-bot.yaml', () => {
  const workflow = load('fro-bot.yaml')

  it.each(JOBS)('%s runs the query through the router, with exactly the two routes', job => {
    const steps = (workflow.jobs[job]?.steps ?? []).filter(step => step.id === 'wiki-query')
    expect(steps).toHaveLength(1)
    expect(steps[0]?.name).toBe('Query wiki context')
    expect(steps[0]?.run?.trim()).toBe(EXPECTED_RUN)
  })

  it('has no other job with a step named like it', () => {
    const named = Object.entries(workflow.jobs).flatMap(([job, {steps = []}]) =>
      steps.filter(step => step.name === 'Query wiki context').map(() => job),
    )
    expect(named.sort()).toStrictEqual([...JOBS].sort())
  })
})

describe('every workflow step that runs the baseline wiki query', () => {
  const runs = readdirSync(WORKFLOWS)
    .filter(name => name.endsWith('.yaml'))
    .flatMap(file =>
      Object.entries(load(file).jobs).flatMap(([job, {steps = []}]) =>
        steps.flatMap(step =>
          step.run?.includes('scripts/wiki-query.ts') === true ? [{file, job, run: step.run}] : [],
        ),
      ),
    )

  it('is one of the three router steps', () => {
    expect(runs.map(({file, job}) => `${file}/${job}`).sort()).toStrictEqual(
      JOBS.map(job => `fro-bot.yaml/${job}`).sort(),
    )
  })

  it('never runs the script bare', () => {
    for (const {file, job, run} of runs) {
      expect(run.trim(), `${file}/${job}`).not.toBe('bun scripts/wiki-query.ts')
      expect(run.trim(), `${file}/${job}`).toMatch(/^bun scripts\/route-stderr\.ts .* bun scripts\/wiki-query\.ts$/u)
    }
  })
})
