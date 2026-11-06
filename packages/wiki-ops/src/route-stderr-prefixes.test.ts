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

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Every non-test source file that can write a `wiki-ingest:` line: the whole published package the ingest comes
 * from, and the script that wraps it.
 */
function emitterSources(): {file: string; text: string}[] {
  const directory = join(REPOSITORY_ROOT, 'packages/wiki-write-core/src')
  const files = readdirSync(directory)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map(name => join(directory, name))
  files.push(join(REPOSITORY_ROOT, 'scripts/wiki-ingest.ts'))
  return files.map(file => ({file, text: readFileSync(file, 'utf8')}))
}

/** Lines with this text after `wiki-ingest:` are diagnostics for a person, not routed records. */
const NON_RECORD_FOLLOW = ' '

/** Every place `text` mentions `wiki-ingest` followed by a colon, and what follows. */
function colonMentions(text: string): string[] {
  const needle = 'wiki-ingest:'
  const mentions: string[] = []
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    mentions.push(text.slice(at + needle.length, at + needle.length + 40))
  }
  return mentions
}

/** A `<kind>:` at the start of `rest`, where a kind is lowercase letters and dashes. */
function leadingKind(rest: string): string | undefined {
  const colon = rest.indexOf(':')
  if (colon < 1) return undefined
  const kind = rest.slice(0, colon)
  return [...kind].every(char => (char >= 'a' && char <= 'z') || char === '-') ? kind : undefined
}

interface EmitterScan {
  /** Kinds written as a `wiki-ingest:<kind>:` literal, in any quoting, call or template form. */
  readonly kinds: string[]
  /** Mentions that are neither a `<kind>:` literal nor the allowed `wiki-ingest: <text>` diagnostic form. */
  readonly unrecognised: string[]
}

function scanEmitters(sources: readonly {file: string; text: string}[]): EmitterScan {
  const kinds = new Set<string>()
  const unrecognised: string[] = []
  for (const {file, text} of sources) {
    for (const rest of colonMentions(text)) {
      const kind = leadingKind(rest)
      if (kind !== undefined) kinds.add(kind)
      else if (!rest.startsWith(NON_RECORD_FOLLOW)) unrecognised.push(`${file}: wiki-ingest:${rest}`)
    }
    // The literal split around a variable or a plus sign cannot be matched to a route, so it is refused.
    for (const split of [
      "'wiki-ingest' +",
      '"wiki-ingest" +',
      '`wiki-ingest${',
      "'wiki-ingest:' +",
      '"wiki-ingest:" +',
    ]) {
      if (text.includes(split)) unrecognised.push(`${file}: builds the prefix in pieces (${split})`)
    }
  }
  return {kinds: [...kinds].sort(), unrecognised}
}

const emittedWikiIngestKinds = (): string[] => scanEmitters(emitterSources()).kinds

/**
 * Kinds an ingest step deliberately does not route. The fro-bot ingest steps never routed findings; the survey
 * commit step routes every kind. An entry here must be true: a routed kind listed as unrouted fails.
 */
const UNROUTED_KINDS: Readonly<Record<string, readonly string[]>> = {
  'fro-bot-ingest': ['finding'],
  'survey-wiki-commit': [],
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
  it('writes exactly the kinds `warning` and `finding`, in every file that can write a wiki-ingest line', () => {
    const scan = scanEmitters(emitterSources())
    expect(scan.kinds).toStrictEqual(['finding', 'warning'])
    expect(scan.unrecognised).toStrictEqual([])
  })

  it('scans the whole package and the wrapping script', () => {
    const files = emitterSources().map(source => source.file)
    expect(files.some(file => file.endsWith('packages/wiki-write-core/src/wiki-ingest.ts'))).toBe(true)
    expect(files.some(file => file.endsWith('scripts/wiki-ingest.ts'))).toBe(true)
    expect(files.some(file => file.endsWith('.test.ts'))).toBe(false)
  })

  describe('the scan', () => {
    const scan = (text: string): EmitterScan => scanEmitters([{file: 'x.ts', text: text.replaceAll('@{', '${')}])

    it.each([
      ['a template literal', 'process.stderr.write(`wiki-ingest:warning:@{x}\\n`)'],
      ['a single-quoted string', "process.stderr.write('wiki-ingest:warning:' + x)"],
      ['a double-quoted string', String.raw`process.stderr.write("wiki-ingest:warning:x\n")`],
      ['a helper argument', 'emit(`wiki-ingest:warning:@{x}`)'],
      ['a constant', "const PREFIX = 'wiki-ingest:warning:'"],
      ['a multi-line call', 'process.stderr.write(\n  `wiki-ingest:warning:@{x}`,\n)'],
    ])('finds the kind in %s', (_name, text) => {
      expect(scan(text).kinds).toStrictEqual(['warning'])
    })

    it('collects different kinds, once each', () => {
      const result = scan('a(`wiki-ingest:b-kind:`); a(`wiki-ingest:a:`); a(`wiki-ingest:a:`)')
      expect(result.kinds).toStrictEqual(['a', 'b-kind'])
      expect(result.unrecognised).toStrictEqual([])
    })

    it('allows the human diagnostic form `wiki-ingest: <text>`', () => {
      const result = scan('process.stderr.write(`::error::wiki-ingest: @{message}\\n`)')
      expect(result.kinds).toStrictEqual([])
      expect(result.unrecognised).toStrictEqual([])
    })

    it.each([
      ['a kind built from a variable', 'write(`wiki-ingest:@{kind}:x`)'],
      ['an upper-case kind', 'write(`wiki-ingest:Warning:x`)'],
      ['a kind with no closing colon', 'write(`wiki-ingest:warning`)'],
      ['an empty kind', 'write(`wiki-ingest::x`)'],
      ['the prefix joined to a variable', "write('wiki-ingest:' + kind + ':')"],
      ['the name split from the colon', "write('wiki-ingest' + ':warning:')"],
      ['a template that starts with the name', 'write(`wiki-ingest@{sep}warning:`)'],
    ])('refuses %s', (_name, text) => {
      expect(scan(text).unrecognised.length).toBeGreaterThan(0)
    })
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

  it.each(ingestSteps.map(step => [`${step.file}/${step.job}`, step] as const))(
    '%s routes every emitted kind or lists it as deliberately unrouted, and lists nothing it routes',
    (_name, step) => {
      const routed = new Set(routesOf(step).map(route => route.prefix))
      const unrouted = UNROUTED_KINDS[step.key] ?? []
      for (const kind of emittedWikiIngestKinds()) {
        const isRouted = routed.has(`wiki-ingest:${kind}:`)
        expect(isRouted || unrouted.includes(kind), `${kind} is neither routed nor listed as unrouted`).toBe(true)
        expect(isRouted && unrouted.includes(kind), `${kind} is routed and listed as unrouted`).toBe(false)
      }
      for (const kind of unrouted) expect(emittedWikiIngestKinds()).toContain(kind)
    },
  )

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
