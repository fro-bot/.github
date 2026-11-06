import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {CorrectionStoreError, type CorrectionsReadResult} from '@fro.bot/wiki-write-core/corrections'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
import {loadRouterSteps, type RouterStep} from '../fixtures/route-stderr-workflow-steps.ts'
import {renderCorrectionsContext} from './render-corrections-context.ts'
import {buildSummary, parseRoute, type Route} from './route-stderr.ts'

/**
 * The emitters write `<tool>:<kind>:<json or text>` lines to stderr, and a workflow step routes the kinds it
 * wants into the job summary. A kind no step routes is invisible in the summary, so the vocabulary is pinned
 * here: adding a kind to an emitter fails this test until a step routes it, or this file says why it does not.
 */

const WIKI_INGEST_SOURCE = readFileSync(
  fileURLToPath(new URL('../../wiki-write-core/src/wiki-ingest.ts', import.meta.url)),
  'utf8',
)

/** Every `wiki-ingest:<kind>:` literal the emitter's source writes to stderr. */
function emittedWikiIngestKinds(): string[] {
  const kinds = new Set<string>()
  for (const match of WIKI_INGEST_SOURCE.matchAll(/process\.stderr\.write\(\s*`wiki-ingest:([a-z]+):/gu)) {
    if (match[1] !== undefined) kinds.add(match[1])
  }
  return [...kinds].sort()
}

function routesOf(step: RouterStep): Route[] {
  const specs: string[] = []
  step.routerFlags.forEach((token, index) => {
    if (token === '--route') specs.push(step.routerFlags[index + 1] ?? '')
  })
  return specs.map(parseRoute)
}

const steps = loadRouterSteps()
const ingestSteps = steps.filter(step => step.key !== 'survey-corrections')
const corrections = steps.find(step => step.key === 'survey-corrections')

describe('every workflow step that runs an emitter', () => {
  const workflowsDirectory = fileURLToPath(new URL('../../../.github/workflows/', import.meta.url))

  /** Every `run:` text in every workflow, with the file it came from. */
  function allRuns(): {file: string; run: string}[] {
    const runs: {file: string; run: string}[] = []
    for (const file of readdirSync(workflowsDirectory).filter(name => name.endsWith('.yaml'))) {
      const workflow = parse(readFileSync(join(workflowsDirectory, file), 'utf8')) as {
        jobs?: Record<string, {steps?: {run?: string}[]}>
      }
      for (const job of Object.values(workflow.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (step.run !== undefined) runs.push({file, run: step.run})
        }
      }
    }
    return runs
  }

  it.each(['scripts/wiki-ingest.ts', 'scripts/render-corrections-context.ts'])(
    'runs %s only as the command the router wraps',
    script => {
      const running = allRuns().filter(({run}) => run.includes(script))
      expect(running.length).toBeGreaterThan(0)
      for (const {file, run} of running) {
        expect(run.replaceAll(/\s+/gu, ' ').trim(), file).toMatch(
          new RegExp(String.raw`^bun scripts/route-stderr\.ts .* bun ${script.replaceAll('.', String.raw`\.`)}$`, 'u'),
        )
      }
    },
  )

  it('counts three writer steps for wiki-ingest.ts and one for the corrections render', () => {
    const count = (script: string): number => allRuns().filter(({run}) => run.includes(script)).length
    expect(count('scripts/wiki-ingest.ts')).toBe(3)
    expect(count('scripts/render-corrections-context.ts')).toBe(1)
  })
})

describe('the wiki-ingest emitter', () => {
  it('writes exactly the kinds `warning` and `finding`', () => {
    expect(emittedWikiIngestKinds()).toStrictEqual(['finding', 'warning'])
  })

  it('has a route for every kind in the survey commit step', () => {
    const survey = steps.find(step => step.key === 'survey-wiki-commit')
    const prefixes = routesOf(survey as RouterStep).map(route => route.prefix)
    expect(prefixes.sort()).toStrictEqual(emittedWikiIngestKinds().map(kind => `wiki-ingest:${kind}:`))
  })

  it('has a route for `warning` and none for `finding` in both fro-bot ingest steps, as the shell steps had', () => {
    const froBot = steps.filter(step => step.key === 'fro-bot-ingest')
    expect(froBot).toHaveLength(2)
    for (const step of froBot) {
      expect(routesOf(step).map(route => route.prefix)).toStrictEqual(['wiki-ingest:warning:'])
    }
  })

  it('is routed by every step that runs it, and by no other prefix', () => {
    const prefixes = new Set(emittedWikiIngestKinds().map(kind => `wiki-ingest:${kind}:`))
    for (const step of ingestSteps) {
      expect(step.wrapped).toStrictEqual(['bun', 'scripts/wiki-ingest.ts'])
      for (const route of routesOf(step)) expect(prefixes.has(route.prefix)).toBe(true)
    }
  })
})

describe('the corrections emitter', () => {
  const nodeId = 'R_kgDOExample'
  const emptyStore: CorrectionsReadResult = {corrections: {version: 1, corrections: []}, warnings: []}

  async function emitted(readCorrections: () => Promise<CorrectionsReadResult>): Promise<string> {
    const lines: string[] = []
    try {
      await renderCorrectionsContext(
        {REPO_NODE_ID: nodeId},
        {
          readCorrections,
          writeFile: async () => undefined,
          stderr: text => {
            lines.push(text)
          },
        },
      )
    } catch {
      // A read failure rethrows after its warning line; the line is what this test reads.
    }
    return lines.join('')
  }

  const readers: [string, () => Promise<CorrectionsReadResult>][] = [
    ['a read warning', async () => ({...emptyStore, warnings: ['entry 3 skipped']})],
    [
      'a store error',
      async () => {
        throw new CorrectionStoreError({code: 'READ_FAILED', path: 'knowledge/corrections.yaml', message: 'unreadable'})
      },
    ],
  ]

  it.each(readers)('writes only lines the survey corrections step routes, for %s', async (_name, reader) => {
    const stderr = await emitted(reader)
    expect(stderr).not.toBe('')
    const routes = routesOf(corrections as RouterStep)
    expect(routes).toHaveLength(1)
    for (const line of stderr.split('\n').filter(candidate => candidate !== '')) {
      expect(line.startsWith(routes[0]?.prefix ?? '\u0000')).toBe(true)
    }
    expect(buildSummary(stderr, routes, 'all')).toContain('### Correction context warnings\n- ')
  })

  it('writes nothing for a clean store', async () => {
    expect(await emitted(async () => emptyStore)).toBe('')
  })

  it('is wrapped by the survey corrections step, with the whole stderr appended', () => {
    expect(corrections?.wrapped).toStrictEqual(['bun', 'scripts/render-corrections-context.ts'])
    expect(corrections?.routerFlags).toContain('all')
  })
})
