/**
 * Pins every data sync in `.github/workflows/` to the `sync-data` composite action, with the
 * inputs each caller declares. The action's own behavior (probe, retry, restore) is pinned once, in
 * `sync-data-action.test.ts`; this file pins who calls it and how.
 *
 * Adding, removing or re-pointing a call site fails here until {@link CALLERS} changes with it. A
 * workflow `run:` step that syncs from `origin data` in shell fails here too, so a new copy of the
 * old block cannot land unnoticed.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const WORKFLOWS_DIR = resolve(import.meta.dirname, '../.github/workflows')
const ACTION = './.github/actions/sync-data'
const OVERLAY = '⤵ Overlay metadata from data branch'
const WIKI_SYNC = 'Sync wiki from data branch'

interface Step {
  name?: string
  id?: string
  uses?: string
  if?: string
  run?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
  'continue-on-error'?: boolean
}

interface Job {
  steps?: Step[]
  outputs?: Record<string, unknown>
}

interface Workflow {
  jobs?: Record<string, Job>
}

/** How a call site is found in its job: by step id when it has one, else by step name. */
type Site = {id: string} | {name: string}

/** The step a call site must come after: the job's checkout, or a named step. */
type Anchor = 'checkout' | {name: string}

interface Caller {
  workflow: string
  job: string
  site: Site
  paths: string
  ifAbsent: 'skip' | 'fail'
  follows: Anchor
  /** The first step in the job that reads the synced files; the sync must come before it. */
  precedes: Site
  /** The sync step's own `if:`, or undefined when it runs unconditionally. */
  if?: string
  continueOnError?: true
}

/**
 * The data-sync caller table from the plan, one row per call site. `follows` and `precedes` bound the
 * sync from both sides: after the checkout (or the named anchor) and before the first step that reads
 * the files it restores. Every job has such a step, so no row is without a `precedes`.
 */
const CALLERS: readonly Caller[] = [
  {
    workflow: 'capture-learnings.yaml',
    job: 'capture-learnings-harvest',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'harvest'},
  },
  {
    workflow: 'capture-learnings.yaml',
    job: 'capture-learnings-publish',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'open'},
  },
  {
    workflow: 'capture-patterns.yaml',
    job: 'detect',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'detect'},
  },
  {
    workflow: 'capture-patterns.yaml',
    job: 'open-publish',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'open'},
  },
  {
    workflow: 'cross-repo-dispatch.yaml',
    job: 'dispatch',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'dispatch'},
  },
  {
    workflow: 'cross-repo-dispatch.yaml',
    job: 'track',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'track'},
  },
  {
    workflow: 'draft-solutions.yaml',
    job: 'publish',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'publish'},
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-observe',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'solutions-query'},
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-observe-announce',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'digest-counts'},
  },
  {
    workflow: 'improvement-metrics.yaml',
    job: 'detect',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'detect'},
  },
  {
    workflow: 'reconcile-repos.yaml',
    job: 'reconcile-repos',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {name: '🔁 Reconcile repos'},
  },
  {
    workflow: 'status-truth.yaml',
    job: 'detect',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'detect'},
  },
  {
    workflow: 'status-truth.yaml',
    job: 'open',
    site: {name: OVERLAY},
    paths: 'metadata/',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'open'},
  },
  {
    workflow: 'survey-repo.yaml',
    job: 'survey-repo',
    site: {name: 'Overlay metadata from data branch'},
    paths: 'metadata',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'onboarded'},
  },
  {
    workflow: 'survey-repo.yaml',
    job: 'survey-persist',
    site: {name: 'Overlay metadata from data branch'},
    paths: 'metadata',
    ifAbsent: 'skip',
    follows: {name: 'Validate and apply wiki handoff'},
    precedes: {id: 'onboarded-persist'},
    if: "needs.survey-repo.outputs.wiki-artifact-ready == 'success' && steps.recheck.conclusion == 'success'",
  },
  {
    workflow: 'wiki-lint.yaml',
    job: 'wiki-lint',
    site: {id: 'restore-wiki'},
    paths: 'knowledge',
    ifAbsent: 'fail',
    follows: 'checkout',
    precedes: {name: 'Run wiki lint'},
    continueOnError: true,
  },
  {
    workflow: 'wiki-lint.yaml',
    job: 'wiki-repair',
    site: {id: 'restore-data'},
    paths: 'knowledge metadata/repos.yaml',
    ifAbsent: 'fail',
    follows: {name: "📦 Grandfather main's wiki repos"},
    precedes: {id: 'repair'},
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot',
    site: {id: 'sync-wiki'},
    paths: 'knowledge',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'wiki-baseline'},
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-wiki-ingest',
    site: {id: 'sync-wiki'},
    paths: 'knowledge',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {name: 'Validate and apply wiki handoff'},
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-remediate',
    site: {name: WIKI_SYNC},
    paths: 'knowledge',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'wiki-query'},
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-observe',
    site: {id: 'sync-wiki'},
    paths: 'knowledge',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'wiki-baseline'},
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-observe-wiki-ingest',
    site: {id: 'sync-wiki'},
    paths: 'knowledge',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {name: 'Validate and apply wiki handoff'},
  },
  {
    workflow: 'survey-repo.yaml',
    job: 'survey-repo',
    site: {id: 'sync-wiki'},
    paths: 'knowledge',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {id: 'wiki-baseline'},
  },
  {
    workflow: 'survey-repo.yaml',
    job: 'survey-persist',
    site: {id: 'sync-wiki'},
    paths: 'knowledge',
    ifAbsent: 'skip',
    follows: 'checkout',
    precedes: {name: 'Validate and apply wiki handoff'},
    if: "needs.survey-repo.outputs.wiki-artifact-ready == 'success' && steps.recheck.conclusion == 'success'",
  },
]

/**
 * The `run:` steps allowed to read `data` themselves, all in merge-data.yaml: the qualification fetch of the
 * `decide` job, the pin that reads the remote `data` tip once after the merge-back, and the promotion diff
 * fetch. None of them restores files from `data`, so none can use the `sync-data` action. `reads` is the
 * command the step must still contain, so an exemption cannot rot.
 */
const SHELL_EXEMPTIONS: readonly {workflow: string; step: string; reads: string}[] = [
  {
    workflow: 'merge-data.yaml',
    step: '🔒 Probe and fetch data ref for qualification',
    reads: 'git ls-remote --exit-code origin refs/heads/data',
  },
  {
    workflow: 'merge-data.yaml',
    step: '📌 Pin the data commit',
    reads: 'git ls-remote --exit-code origin refs/heads/data',
  },
  {
    workflow: 'merge-data.yaml',
    step: '🔒 Fetch data ref for promotion diff',
    reads: 'git fetch --no-tags --prune origin data',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const workflows = new Map<string, Workflow>()
for (const file of readdirSync(WORKFLOWS_DIR)
  .filter(name => /\.ya?ml$/.test(name))
  .toSorted()) {
  const parsed: unknown = parse(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8'))
  if (isRecord(parsed)) workflows.set(file, parsed)
}

const jobOf = (workflow: string, job: string): Job | undefined => workflows.get(workflow)?.jobs?.[job]
const stepsOf = (workflow: string, job: string): Step[] => jobOf(workflow, job)?.steps ?? []

const siteLabel = (site: Site): string => ('id' in site ? `id ${site.id}` : `name ${site.name}`)
const matchesSite = (step: Step, site: Site): boolean => ('id' in site ? step.id === site.id : step.name === site.name)
const callerKey = (caller: Caller): string => `${caller.workflow}#${caller.job}#${siteLabel(caller.site)}`

/** Every `uses: sync-data` step in every workflow, keyed the same way as {@link callerKey}. */
function discoverCallSites(): {workflow: string; job: string; step: Step; index: number}[] {
  const found: {workflow: string; job: string; step: Step; index: number}[] = []
  for (const [workflow, definition] of workflows) {
    for (const [job, body] of Object.entries(definition.jobs ?? {})) {
      for (const [index, step] of (body.steps ?? []).entries()) {
        if (step.uses === ACTION) found.push({workflow, job, step, index})
      }
    }
  }
  return found
}

const callSites = discoverCallSites()

describe('data sync callers: the caller list', () => {
  it('lists 24 call sites with distinct keys', () => {
    expect(CALLERS).toHaveLength(24)
    expect(new Set(CALLERS.map(callerKey)).size).toBe(24)
  })

  it('finds exactly the listed call sites in the workflows, no more and no fewer', () => {
    expect(callSites).toHaveLength(CALLERS.length)
    const discovered = callSites.map(({workflow, job, step}) => {
      const caller = CALLERS.find(row => row.workflow === workflow && row.job === job && matchesSite(step, row.site))
      return caller === undefined
        ? `UNLISTED ${workflow}#${job}#${step.id ?? step.name ?? '(unnamed)'}`
        : callerKey(caller)
    })

    expect(discovered.toSorted()).toStrictEqual(CALLERS.map(callerKey).toSorted())
  })

  it.each(CALLERS.map(caller => [callerKey(caller), caller] as const))('%s: declares its inputs', (_key, caller) => {
    const matches = stepsOf(caller.workflow, caller.job).filter(step => matchesSite(step, caller.site))

    expect(matches).toHaveLength(1)
    const [step] = matches
    expect(step?.uses).toBe(ACTION)
    // Exactly the two declared inputs: no token, no extra input a later edit could smuggle in.
    expect(step?.with).toStrictEqual({paths: caller.paths, 'if-absent': caller.ifAbsent})
    expect(step?.run).toBeUndefined()
    expect(step?.env).toBeUndefined()
    expect(step?.['continue-on-error']).toBe(caller.continueOnError)
    // A sync that gains, loses or changes its condition changes when the data is restored.
    expect(step?.if).toBe(caller.if)
  })

  it.each(CALLERS.map(caller => [callerKey(caller), caller] as const))('%s: keeps its order', (_key, caller) => {
    const steps = stepsOf(caller.workflow, caller.job)
    const syncIndex = steps.findIndex(step => matchesSite(step, caller.site))
    expect(syncIndex).toBeGreaterThanOrEqual(0)

    const checkoutIndexes = steps.flatMap((step, index) =>
      (step.uses ?? '').startsWith('actions/checkout@') ? [index] : [],
    )
    expect(checkoutIndexes.length, 'job has a checkout').toBeGreaterThan(0)
    // The sync restores files into the checkout, so it follows the first checkout, and no later checkout wipes it.
    expect(syncIndex).toBeGreaterThan(Math.min(...checkoutIndexes))
    expect(checkoutIndexes.filter(index => index > syncIndex)).toStrictEqual([])

    // The first step that reads the synced files comes after the sync, so a step moved above it fails here.
    const precedesIndex = steps.findIndex(step => matchesSite(step, caller.precedes))
    expect(precedesIndex, `consuming step ${siteLabel(caller.precedes)} exists`).toBeGreaterThanOrEqual(0)
    expect(syncIndex).toBeLessThan(precedesIndex)

    if (caller.follows !== 'checkout') {
      const anchorName = caller.follows.name
      const anchorIndex = steps.findIndex(step => step.name === anchorName)
      expect(anchorIndex, `anchor step ${anchorName} exists`).toBeGreaterThanOrEqual(0)
      expect(syncIndex).toBeGreaterThan(anchorIndex)
    }
  })

  it('wiki-repair syncs after main`s wiki repos are copied aside, so data pages cannot match themselves', () => {
    const steps = stepsOf('wiki-lint.yaml', 'wiki-repair')
    const grandfather = steps.findIndex(step => step.name === "📦 Grandfather main's wiki repos")
    const sync = steps.findIndex(step => step.id === 'restore-data')

    expect(grandfather).toBeGreaterThanOrEqual(0)
    expect(sync).toBeGreaterThan(grandfather)
    expect(steps[grandfather]?.run).toContain('grandfather-wiki-repos')
  })
})

describe('data sync callers: no workflow syncs data in shell', () => {
  const touchesData = (line: string): boolean =>
    /\bgit\s+(?:ls-remote|fetch|checkout|restore)\b/.test(line) &&
    /\borigin\s+(?:refs\/heads\/)?data\b|\borigin\/data\b|--source\s+FETCH_HEAD|\bFETCH_HEAD\b/.test(line)

  const runSteps: {key: string; workflow: string; name: string; run: string}[] = []
  for (const [workflow, definition] of workflows) {
    for (const [job, body] of Object.entries(definition.jobs ?? {})) {
      for (const step of body.steps ?? []) {
        if (typeof step.run === 'string') {
          const name = step.name ?? step.id ?? '(unnamed)'
          runSteps.push({key: `${workflow}#${job}#${name}`, workflow, name, run: step.run})
        }
      }
    }
  }

  it('scans a real set of run steps, so the checks below cannot be vacuous', () => {
    expect(runSteps.length).toBeGreaterThan(100)
    expect(runSteps.some(step => step.workflow === 'merge-data.yaml')).toBe(true)
  })

  it('no run: step probes, fetches, checks out or restores from origin data, except the named exemption', () => {
    const offenders = runSteps
      .filter(step => !SHELL_EXEMPTIONS.some(exempt => exempt.workflow === step.workflow && exempt.step === step.name))
      .filter(step => step.run.split('\n').some(line => touchesData(line)))
      .map(step => step.key)

    expect(offenders).toStrictEqual([])
  })

  it('the exemption still exists and still fetches data, so it cannot rot', () => {
    for (const exempt of SHELL_EXEMPTIONS) {
      const step = runSteps.find(candidate => candidate.workflow === exempt.workflow && candidate.name === exempt.step)
      expect(step, `${exempt.workflow}: ${exempt.step}`).toBeDefined()
      expect(step?.run).toContain(exempt.reads)
    }
  })

  it('no run: step pipes a fetch, checkout or restore into || true', () => {
    const offenders = runSteps
      .filter(step =>
        step.run
          .split('\n')
          .some(line => /\bgit\s+(?:fetch|checkout|restore)\b/.test(line) && /\|\|\s*true\b/.test(line)),
      )
      .map(step => step.key)

    expect(offenders).toStrictEqual([])
  })

  it('the shell matcher recognizes the old blocks, so an empty offender list means something', () => {
    expect(touchesData('git ls-remote --exit-code origin data >/dev/null || status=$?')).toBe(true)
    expect(touchesData('git fetch --no-tags origin data')).toBe(true)
    expect(touchesData('git checkout origin/data -- metadata/')).toBe(true)
    expect(touchesData('git restore --source FETCH_HEAD --worktree -- knowledge')).toBe(true)
    expect(touchesData('git fetch origin refs/heads/data')).toBe(true)
    expect(touchesData('git fetch origin main')).toBe(false)
  })
})

describe('data sync callers: step references still resolve', () => {
  const syncWorkflows = [...new Set(CALLERS.map(caller => caller.workflow))]
  const reference = /steps\.([\w-]+)\.(outcome|conclusion|outputs\.data-sha)\b/g

  it.each(syncWorkflows)(
    '%s: every steps.<id> outcome or data-sha reference names a step in the same job',
    workflow => {
      for (const [job, body] of Object.entries(workflows.get(workflow)?.jobs ?? {})) {
        const ids = new Set((body.steps ?? []).flatMap(step => (step.id === undefined ? [] : [step.id])))
        for (const match of JSON.stringify(body).matchAll(reference)) {
          const id = match[1] ?? ''
          // Only the job's own references: a `needs.<job>.outputs...` text never matches `steps.`.
          expect(ids.has(id), `${workflow}#${job} references steps.${id}.${match[2]}`).toBe(true)
        }
      }
    },
  )

  it.each(syncWorkflows)('%s: every steps.<id>.outputs.data-sha reads from a sync-data step', workflow => {
    for (const [job, body] of Object.entries(workflows.get(workflow)?.jobs ?? {})) {
      for (const match of JSON.stringify(body).matchAll(/steps\.([\w-]+)\.outputs\.data-sha\b/g)) {
        const source = (body.steps ?? []).find(step => step.id === match[1])
        expect(source?.uses, `${workflow}#${job} steps.${match[1]}.outputs.data-sha`).toBe(ACTION)
      }
    }
  })

  it('no workflow still reads the retired data_sha output', () => {
    for (const [workflow, definition] of workflows) {
      expect(JSON.stringify(definition), workflow).not.toContain('outputs.data_sha')
    }
  })

  it('wiki-lint`s lint and repair paths read data-sha from their own sync', () => {
    const expressionStart = '$' + '{{'
    const lint = stepsOf('wiki-lint.yaml', 'wiki-lint').find(step => step.name === 'Run wiki lint')
    const repair = stepsOf('wiki-lint.yaml', 'wiki-repair').find(step => step.id === 'repair')

    expect(lint?.env?.WIKI_LINT_SNAPSHOT_SHA).toBe(`${expressionStart} steps.restore-wiki.outputs.data-sha }}`)
    expect(repair?.env?.WIKI_REPAIR_DATA_TIP_SHA).toBe(`${expressionStart} steps.restore-data.outputs.data-sha }}`)
    expect(lint?.if).toBe("steps.restore-wiki.outcome == 'success'")
  })
})
