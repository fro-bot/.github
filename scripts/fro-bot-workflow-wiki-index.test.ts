import {readdirSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {evaluateExpressionValue} from '@fro-bot/test-kit/workflow-expression'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Contract: the two daily-pass jobs of fro-bot.yaml (Remediate and Observe) build the wiki index in one `Build wiki
// index` step each, through the stderr router, so the `page-skipped` and `index-` warnings reach the job summary,
// and no step runs the bare script. The router replays stderr unchanged and keeps the command's stdout,
// `GITHUB_OUTPUT` and exit code, which packages/wiki-ops/src/wiki-index-route.test.ts proves. The pull request,
// issue and comment job builds no index and its prompt says no wiki context is provided; the wiki sync and the
// solutions query stay in all three jobs.

const WORKFLOWS = resolve(import.meta.dirname, '../.github/workflows')

const EXPECTED_RUN =
  "bun scripts/route-stderr.ts --route 'wiki-index:warn:page-skipped =Wiki pages skipped' --route 'wiki-index:warn:index-=Wiki index unavailable' --summary filtered bun scripts/wiki-index.ts"

const DAILY_JOBS = ['fro-bot-remediate', 'fro-bot-observe'] as const
const CONTENT_JOB = 'fro-bot'

interface Step {
  id?: string
  name?: string
  uses?: string
  run?: string
  env?: Record<string, unknown>
}
interface Workflow {
  env?: Record<string, unknown>
  jobs: Record<string, {steps?: Step[]}>
}

function load(file: string): Workflow {
  return parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as Workflow
}

const workflow = load('fro-bot.yaml')
const stepsOf = (job: string): Step[] => workflow.jobs[job]?.steps ?? []
const agentOf = (job: string): Step | undefined => stepsOf(job).find(step => step.id === 'fro-bot-agent')

describe('the wiki index steps of fro-bot.yaml', () => {
  it.each(DAILY_JOBS)('%s builds the index through the router, with exactly the two routes and no env', job => {
    const steps = stepsOf(job).filter(step => step.id === 'wiki-index')

    expect(steps).toHaveLength(1)
    expect(steps[0]?.name).toBe('Build wiki index')
    expect(steps[0]?.run?.trim()).toBe(EXPECTED_RUN)
    expect(steps[0]?.env).toBeUndefined()
    expect(steps[0]?.uses).toBeUndefined()
  })

  it('has no other job with a step named like it', () => {
    const named = Object.entries(workflow.jobs).flatMap(([job, {steps = []}]) =>
      steps.filter(step => step.name === 'Build wiki index').map(() => job),
    )

    expect(named.toSorted()).toStrictEqual([...DAILY_JOBS].toSorted())
  })

  it('gives the pull request, issue and comment job no wiki query or index step, and keeps its wiki sync and solutions query', () => {
    const steps = stepsOf(CONTENT_JOB)

    expect(steps.some(step => step.id === 'wiki-query' || step.id === 'wiki-index')).toBe(false)
    expect(steps.some(step => step.name === 'Query wiki context' || step.name === 'Build wiki index')).toBe(false)
    expect(steps.some(step => step.run?.includes('scripts/wiki-index.ts') === true)).toBe(false)
    expect(steps.find(step => step.id === 'sync-wiki')?.uses).toBe('./.github/actions/sync-data')
    expect(steps.find(step => step.id === 'solutions-query')?.run).toBe('bun scripts/solutions-query.ts')
    expect(agentOf(CONTENT_JOB)?.env?.SOLUTIONS_CONTEXT).toBe('$' + '{{ steps.solutions-query.outputs.excerpt }}')
  })

  it('never mentions the removed query step, script or its outputs in any workflow', () => {
    for (const file of readdirSync(WORKFLOWS).filter(name => name.endsWith('.yaml'))) {
      const text = readFileSync(join(WORKFLOWS, file), 'utf8')

      expect(text, file).not.toContain('wiki-query')
      expect(text, file).not.toContain('WIKI_QUERY_')
      expect(text, file).not.toMatch(/steps\.wiki-[a-z]+\.outputs\.excerpt/u)
    }
  })
})

describe('every workflow step that runs the wiki index', () => {
  const runs = readdirSync(WORKFLOWS)
    .filter(name => name.endsWith('.yaml'))
    .flatMap(file =>
      Object.entries(load(file).jobs).flatMap(([job, {steps = []}]) =>
        steps.flatMap(step =>
          step.run?.includes('scripts/wiki-index.ts') === true ? [{file, job, run: step.run}] : [],
        ),
      ),
    )

  it('is one of the two router steps', () => {
    expect(runs.map(({file, job}) => `${file}/${job}`).toSorted()).toStrictEqual(
      DAILY_JOBS.map(job => `fro-bot.yaml/${job}`).toSorted(),
    )
  })

  it('never runs the script bare', () => {
    for (const {file, job, run} of runs) {
      expect(run.trim(), `${file}/${job}`).not.toBe('bun scripts/wiki-index.ts')
      expect(run.trim(), `${file}/${job}`).toMatch(/^bun scripts\/route-stderr\.ts .* bun scripts\/wiki-index\.ts$/u)
    }
  })
})

describe('what the daily-pass agent steps receive as wiki context', () => {
  const unavailable = String(workflow.env?.WIKI_INDEX_UNAVAILABLE_NOTE ?? '')
  const reference = (text: string): string => /\$\{\{([\s\S]*)\}\}/u.exec(text)?.[1] ?? ''
  const wikiContext = (job: string, index: string | undefined): unknown =>
    evaluateExpressionValue(reference(String(agentOf(job)?.env?.WIKI_CONTEXT ?? '')), {
      steps: {'wiki-index': {outputs: index === undefined ? {} : {index}}},
      env: {WIKI_INDEX_UNAVAILABLE_NOTE: unavailable},
    })

  it.each(DAILY_JOBS)('%s reads the index output of its own index step, with a fallback note', job => {
    expect(agentOf(job)?.env?.WIKI_CONTEXT).toBe(
      '$' + '{{ steps.wiki-index.outputs.index || env.WIKI_INDEX_UNAVAILABLE_NOTE }}',
    )
  })

  it('gives the pull request job no wiki context variable at all', () => {
    expect(agentOf(CONTENT_JOB)?.env?.WIKI_CONTEXT).toBeUndefined()
  })

  it.each(DAILY_JOBS)('%s evaluates to the index when the step wrote one', job => {
    expect(wikiContext(job, 'Wiki index: 1 of 1 pages listed.\nknowledge/wiki/topics/a.md | A | topic')).toBe(
      'Wiki index: 1 of 1 pages listed.\nknowledge/wiki/topics/a.md | A | topic',
    )
  })

  it.each(DAILY_JOBS)('%s evaluates to the unavailable note for an empty or a missing output', job => {
    expect(wikiContext(job, '')).toBe(unavailable)
    expect(wikiContext(job, undefined)).toBe(unavailable)
  })

  it('has an unavailable note that says unavailable and never says the wiki is empty', () => {
    expect(unavailable.trim()).not.toBe('')
    expect(unavailable).toMatch(/unavailable/iu)
    expect(unavailable).not.toMatch(/empty|no pages|nothing/iu)
  })
})

describe('the step order of Remediate', () => {
  const names = stepsOf('fro-bot-remediate').map(step => step.name ?? step.id ?? '')
  const at = (name: string): number => {
    const index = names.indexOf(name)
    expect(index, name).toBeGreaterThanOrEqual(0)
    return index
  }

  it('syncs the wiki, builds the index, then restores knowledge/ to a clean tree before the agent', () => {
    const sync = at('Sync wiki from data branch')
    const index = at('Build wiki index')
    const restore = at('Restore knowledge/ to a clean tree before the agent runs')
    const agent = at('Run Fro Bot')

    expect(sync).toBeLessThan(index)
    expect(index).toBeLessThan(restore)
    expect(restore).toBeLessThan(agent)
  })

  it('names the index script, not a removed one, in the comment on the restore step', () => {
    const text = readFileSync(join(WORKFLOWS, 'fro-bot.yaml'), 'utf8')
    const restoreAt = text.indexOf('- name: Restore knowledge/ to a clean tree before the agent runs')
    const comment = text.slice(text.lastIndexOf('\n\n', restoreAt), restoreAt)

    expect(comment).toContain('wiki-index.ts')
    expect(comment).not.toContain('wiki-query')
  })
})
