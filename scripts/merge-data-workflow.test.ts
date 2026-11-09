import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {afterAll, describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Regression guard: the privacy gates (check-wiki-private-presence.ts and the promotion leak gate) must
// run BEFORE the promotion-PR step (merge-data-pr.ts), on the one `data` commit the pin step read. A
// refactor that reorders steps would silently break the gates without this test.

interface Step {
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
  id?: string
  'continue-on-error'?: boolean
  if?: string
}

interface Job {
  name?: string
  needs?: string | string[]
  if?: string
  'timeout-minutes'?: number
  permissions?: Record<string, string>
  outputs?: Record<string, string>
  steps: Step[]
}

/** Narrow the parsed YAML to the shape we index into, without any broad cast. */
function assertMergeDataWorkflow(value: unknown): asserts value is {
  on: {
    push?: {branches?: string[]}
    repository_dispatch?: {types?: string[]}
    schedule?: {cron?: string}[]
    workflow_dispatch?: {inputs?: Record<string, {type?: string; default?: unknown; description?: string}>}
  }
  permissions?: Record<string, string>
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean | string}
  jobs: Record<string, Job>
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

const expressionStart = '$' + '{{'
const APP_TOKEN = `${expressionStart} steps.get-workflow-app-token.outputs.token }}`
const PIN = `${expressionStart} steps.pin.outputs.sha }}`

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/merge-data.yaml')
const workflowRaw = readFileSync(workflowPath, 'utf8')
const parsed: unknown = parse(workflowRaw)
assertMergeDataWorkflow(parsed)
const decide = parsed.jobs.decide
const promotion = parsed.jobs['merge-data']
if (decide === undefined || promotion === undefined) {
  throw new TypeError('merge-data.yaml must define the decide and merge-data jobs')
}
const steps = promotion.steps
const decideSteps = decide.steps

function indexOfStep(predicate: (step: Step) => boolean, list: readonly Step[] = steps): number {
  return list.findIndex(predicate)
}

describe('merge-data.yaml triggers, concurrency and permissions', () => {
  it('triggers on the explicit promotion dispatch, the weekly and daily schedules and manual dispatch', () => {
    expect(parsed.on.push).toBeUndefined()
    expect(parsed.on.repository_dispatch?.types).toEqual(['promote-data'])
    expect(parsed.on.schedule).toEqual([{cron: '0 22 * * 0'}, {cron: '0 22 * * 1-6'}])
    expect(parsed.on).toHaveProperty('workflow_dispatch')
  })

  it('offers a refresh-review dispatch input that defaults to false', () => {
    const input = parsed.on.workflow_dispatch?.inputs?.['refresh-review']
    expect(input?.type).toBe('boolean')
    expect(input?.default).toBe(false)
    expect(input?.description).toContain('closed')
    expect(Object.keys(parsed.on.workflow_dispatch?.inputs ?? {})).toEqual(['refresh-review'])
  })

  it('keeps least-privilege top-level permissions unchanged', () => {
    expect(parsed.permissions).toEqual({contents: 'read'})
  })

  it('serializes every trigger in one group and never cancels a run in flight', () => {
    expect(parsed.concurrency).toEqual({group: 'merge-data', 'cancel-in-progress': false})
  })

  it('does not reference repository_dispatch client payload data', () => {
    expect(workflowRaw).not.toContain('client_payload')
  })

  it('defines exactly the decide and merge-data jobs', () => {
    expect(Object.keys(parsed.jobs)).toEqual(['decide', 'merge-data'])
  })
})

describe('merge-data.yaml decide job', () => {
  it('reads contents only and finishes quickly', () => {
    expect(decide.permissions).toEqual({contents: 'read'})
    expect(decide['timeout-minutes']).toBe(10)
    expect(decide.needs).toBeUndefined()
    expect(decide.if).toBeUndefined()
  })

  it('checks out main with full history, sets up, fetches data and qualifies, in that order', () => {
    expect(decideSteps.map(step => step.name)).toEqual([
      '⤵ Checkout Branch',
      '📦 Setup',
      '🔒 Fetch data ref for qualification',
      '🧮 Decide whether to promote',
    ])
    expect(decideSteps[0]?.with).toMatchObject({ref: 'main', 'fetch-depth': 0})
    expect(decideSteps[1]?.uses).toBe('./.github/actions/setup')
    expect(decideSteps[2]?.run).toBe('git fetch --no-tags --prune origin data')
  })

  it('runs the qualification with the trigger and no token', () => {
    const qualify = decideSteps[3]
    expect(qualify?.id).toBe('qualify')
    expect(qualify?.run).toBe('bun scripts/promotion-qualify.ts')
    expect(qualify?.env).toEqual({
      PROMOTION_SCHEDULE: `${expressionStart} github.event.schedule }}`,
      PROMOTION_REFRESH_REVIEW: `${expressionStart} inputs.refresh-review }}`,
    })
    expect(qualify?.['continue-on-error']).toBeUndefined()
    expect(qualify?.if).toBeUndefined()
  })

  it('outputs run and nothing else, and mints no token', () => {
    expect(decide.outputs).toEqual({run: `${expressionStart} steps.qualify.outputs.run }}`})
    expect(JSON.stringify(decide)).not.toContain('secrets.')
    expect(JSON.stringify(decide)).not.toContain('create-github-app-token')
  })
})

describe('merge-data.yaml promotion job', () => {
  it('runs only when the decision says to run, after the decision, for up to 90 minutes', () => {
    expect(promotion.needs).toBe('decide')
    expect(promotion.if).toBe(`${expressionStart} needs.decide.outputs.run == 'true' }}`)
    expect(promotion['timeout-minutes']).toBe(90)
  })

  it('has the steps in order: token, checkout, setup, merge-back, pin, gates at the pin, qualify, PR, self-merge', () => {
    expect(steps.map(step => step.name)).toEqual([
      'Get Workflow Access Token',
      '⤵ Checkout Branch',
      '📦 Setup',
      '🔁 Merge main into data',
      '📌 Pin the data commit',
      '⤵ Fetch data branch for privacy check',
      '🔒 Block private wiki pages',
      '🔒 Fetch data ref for promotion diff',
      '🔒 Block private repo names in promotion diff',
      '🧮 Qualify promotion at the pinned commit',
      '🔀 Open data merge PR',
      '🤝 Self-merge a qualifying promotion',
    ])
  })

  it('contains the privacy gate step (check-wiki-private-presence.ts)', () => {
    expect(steps.find(s => s.run?.includes('check-wiki-private-presence.ts'))).toBeDefined()
  })

  it('contains the merge PR step (merge-data-pr.ts)', () => {
    expect(steps.find(s => s.run?.includes('merge-data-pr.ts'))).toBeDefined()
  })

  it('runs both privacy gates before the promotion PR step', () => {
    const presence = indexOfStep(s => s.run?.includes('check-wiki-private-presence.ts') === true)
    const leak = indexOfStep(s => s.run?.includes('check-private-leak.ts --promotion') === true)
    const merge = indexOfStep(s => s.run?.includes('merge-data-pr.ts') === true)
    expect(presence).toBeGreaterThanOrEqual(0)
    expect(leak).toBeGreaterThanOrEqual(0)
    expect(merge).toBeGreaterThanOrEqual(0)
    expect(presence).toBeLessThan(merge)
    expect(leak).toBeLessThan(merge)
  })

  it.each(['check-wiki-private-presence.ts', 'check-private-leak.ts --promotion'])(
    'the gate %s has no continue-on-error or if: that could neuter it, and a failed gate leaves the PR step unrun (AE4)',
    gate => {
      const gateStep = steps.find(s => s.run?.includes(gate))
      expect(gateStep).toBeDefined()
      expect(gateStep?.['continue-on-error']).toBeFalsy()
      expect(gateStep?.if).toBeUndefined()
      // The PR step has no always()/failure() condition, so GitHub's default success() skips it after a failed gate.
      const merge = steps.find(s => s.run?.includes('merge-data-pr.ts'))
      expect(merge?.if).toBeUndefined()
      expect(merge?.['continue-on-error']).toBeUndefined()
    },
  )

  it('pins the first checkout to main rather than inheriting github.ref', () => {
    const checkoutStep = steps.find(step => step.uses?.startsWith('actions/checkout@'))
    expect(checkoutStep?.with?.ref).toBe('main')
  })

  it('runs the merge-back after Setup and before the pin, the data checkout, the gates and the promotion PR', () => {
    const mergeBack = indexOfStep(step => step.run?.includes('merge-back-data.ts') === true)
    const setup = indexOfStep(step => step.uses === './.github/actions/setup')
    const pin = indexOfStep(step => step.id === 'pin')
    const dataCheckout = indexOfStep(
      step => step.uses?.startsWith('actions/checkout@') === true && step.with?.ref === PIN,
    )
    const presenceGate = indexOfStep(step => step.run?.includes('check-wiki-private-presence.ts') === true)
    const fetchRef = indexOfStep(step => step.run?.includes('git fetch') === true && step.run.includes('data'))
    const promotionGate = indexOfStep(step => step.run?.includes('check-private-leak.ts --promotion') === true)
    const promotionPr = indexOfStep(step => step.run?.includes('merge-data-pr.ts') === true)

    for (const position of [mergeBack, setup, pin, dataCheckout, presenceGate, fetchRef, promotionGate, promotionPr]) {
      expect(position).toBeGreaterThanOrEqual(0)
    }
    expect(setup).toBeLessThan(mergeBack)
    expect(mergeBack).toBeLessThan(pin)
    expect(pin).toBeLessThan(dataCheckout)
    expect(pin).toBeLessThan(fetchRef)
    expect(dataCheckout).toBeLessThan(presenceGate)
    expect(fetchRef).toBeLessThan(promotionGate)
    expect(promotionGate).toBeLessThan(promotionPr)
  })

  it('gives the merge-back the App token, runs it with bun, and lets nothing neuter it', () => {
    const mergeBack = steps.find(step => step.run?.includes('merge-back-data.ts'))
    const tokenStep = steps.find(step => step.id === 'get-workflow-app-token')

    expect(tokenStep).toBeDefined()
    expect(mergeBack?.run).toBe('bun scripts/merge-back-data.ts')
    expect(mergeBack?.env).toEqual({GITHUB_TOKEN: APP_TOKEN})
    expect(mergeBack?.['continue-on-error']).toBeUndefined()
    expect(mergeBack?.if).toBeUndefined()
  })

  it('checks the wiki gate out at the pinned commit, not at the moving data branch', () => {
    const checkout = steps.find(step => step.name === '⤵ Fetch data branch for privacy check')
    expect(checkout?.uses?.startsWith('actions/checkout@')).toBe(true)
    expect(checkout?.with).toEqual({ref: PIN, path: 'data-branch-check'})
  })

  it('points origin/data at the pin after the fetch, so the leak gate scans exactly the pinned commit', () => {
    const fetch = steps.find(step => step.name === '🔒 Fetch data ref for promotion diff')
    expect(fetch?.run).toBe(
      ['git fetch --no-tags --prune origin data', 'git update-ref refs/remotes/origin/data "$PROMOTION_PIN"', ''].join(
        '\n',
      ),
    )
    expect(fetch?.env).toEqual({PROMOTION_PIN: PIN})
    expect(fetch?.if).toBeUndefined()
    expect(fetch?.['continue-on-error']).toBeUndefined()
  })

  it('qualifies the promotion after the gates, at the pin, with the trigger', () => {
    const qualify = steps.find(step => step.id === 'qualify')
    expect(qualify?.run).toBe('bun scripts/promotion-qualify.ts')
    expect(qualify?.env).toEqual({
      PROMOTION_SCHEDULE: `${expressionStart} github.event.schedule }}`,
      PROMOTION_REFRESH_REVIEW: `${expressionStart} inputs.refresh-review }}`,
    })
    expect(qualify?.if).toBeUndefined()
    expect(qualify?.['continue-on-error']).toBeUndefined()
    const gate = indexOfStep(step => step.run?.includes('check-private-leak.ts --promotion') === true)
    const pr = indexOfStep(step => step.run?.includes('merge-data-pr.ts') === true)
    const at = indexOfStep(step => step.id === 'qualify')
    expect(gate).toBeLessThan(at)
    expect(at).toBeLessThan(pr)
  })

  it('opens the PR with the pin, the qualification and the refresh flag, and exposes the PR number and head', () => {
    const pr = steps.find(step => step.run?.includes('merge-data-pr.ts'))
    expect(pr?.id).toBe('open-pr')
    expect(pr?.run).toBe('bun scripts/merge-data-pr.ts')
    expect(pr?.env).toEqual({
      GITHUB_TOKEN: APP_TOKEN,
      PROMOTION_PIN: PIN,
      PROMOTION_QUALIFIES: `${expressionStart} steps.qualify.outputs.qualifies }}`,
      PROMOTION_REFRESH_REVIEW: `${expressionStart} inputs.refresh-review }}`,
    })
  })

  it('uses the App token in the merge-back and the PR step only, and in nothing after the PR step', () => {
    const users = steps.filter(step => JSON.stringify(step).includes('steps.get-workflow-app-token.outputs.token'))
    expect(users.map(step => step.name)).toEqual(['🔁 Merge main into data', '🔀 Open data merge PR'])
    const prIndex = indexOfStep(step => step.id === 'open-pr')
    for (const step of steps.slice(prIndex + 1)) {
      expect(JSON.stringify(step)).not.toContain('get-workflow-app-token')
      expect(JSON.stringify(step)).not.toContain('GITHUB_TOKEN')
    }
    expect(prIndex).toBe(steps.length - 2)
  })

  it('gives FRO_BOT_PAT to the self-merge step alone, as step env, and reads the switch as a variable', () => {
    const holders = steps.filter(step => JSON.stringify(step).includes('FRO_BOT_PAT'))
    expect(holders).toHaveLength(1)
    const selfMerge = steps.at(-1)
    expect(holders[0]).toBe(selfMerge)
    expect(selfMerge?.name).toBe('🤝 Self-merge a qualifying promotion')
    expect(selfMerge?.run).toBe('bun scripts/promotion-self-merge.ts')
    expect(selfMerge?.env).toEqual({
      GH_TOKEN: `${expressionStart} secrets.FRO_BOT_PAT }}`,
      PROMOTION_SELF_MERGE: `${expressionStart} vars.PROMOTION_SELF_MERGE }}`,
      PROMOTION_PR: `${expressionStart} steps.open-pr.outputs.pull-request }}`,
      PROMOTION_PIN: PIN,
      PROMOTION_QUALIFIES: `${expressionStart} steps.qualify.outputs.qualifies }}`,
    })
    expect(selfMerge?.if).toBeUndefined()
    expect(selfMerge?.['continue-on-error']).toBeUndefined()
    expect(selfMerge?.uses).toBeUndefined()
    // the secret and the variable are on no other step, in no job env, and not in the decide job
    expect(promotion).not.toHaveProperty('env')
    expect(parsed).not.toHaveProperty('env')
    expect(JSON.stringify(decide)).not.toContain('FRO_BOT_PAT')
    expect(workflowRaw.match(/secrets\.FRO_BOT_PAT/gu)).toHaveLength(1)
    expect(workflowRaw.match(/vars\.PROMOTION_SELF_MERGE/gu)).toHaveLength(1)
  })

  it('keeps the PAT out of every git subprocess: no step after the checkout passes it as a token input', () => {
    for (const step of steps.filter(candidate => candidate.uses !== undefined)) {
      expect(JSON.stringify(step.with ?? {})).not.toContain('FRO_BOT_PAT')
    }
  })

  it('self-merges after the PR step, which is the last step before it', () => {
    const pr = indexOfStep(step => step.id === 'open-pr')
    const merge = indexOfStep(step => step.run?.includes('promotion-self-merge.ts') === true)
    expect(merge).toBe(pr + 1)
  })
})

describe('merge-data.yaml pin step', () => {
  const pin = steps.find(step => step.id === 'pin')

  it('reads the remote data ref once and exposes the commit', () => {
    expect(pin?.name).toBe('📌 Pin the data commit')
    expect(pin?.if).toBeUndefined()
    expect(pin?.['continue-on-error']).toBeUndefined()
    expect(pin?.run).toContain('git ls-remote')
    expect(pin?.run).toContain('refs/heads/data')
    expect(pin?.run).toContain('GITHUB_OUTPUT')
  })
})

function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', ...args],
    {cwd, encoding: 'utf8', env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}},
  )
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

describe('merge-data.yaml steps run for real against git', () => {
  const roots: string[] = []

  afterAll(() => {
    for (const root of roots) rmSync(root, {recursive: true, force: true})
  })

  /** A clone of a bare origin whose `main` and `data` branches exist; `withData: false` leaves out `data`. */
  function fixture(withData = true): {clone: string; origin: string} {
    const root = mkdtempSync(join(tmpdir(), 'merge-data-workflow-'))
    roots.push(root)
    const origin = join(root, 'origin.git')
    const seed = join(root, 'seed')
    mkdirSync(seed)
    git(root, 'init', '-q', '--bare', '-b', 'main', origin)
    git(seed, 'init', '-q', '-b', 'main')
    writeFileSync(join(seed, 'a.txt'), 'a\n')
    git(seed, 'add', 'a.txt')
    git(seed, 'commit', '-q', '-m', 'base')
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', '-q', 'origin', 'main')
    if (withData) {
      git(seed, 'checkout', '-q', '-b', 'data')
      writeFileSync(join(seed, 'knowledge.txt'), 'k\n')
      git(seed, 'add', 'knowledge.txt')
      git(seed, 'commit', '-q', '-m', 'data one')
      git(seed, 'push', '-q', 'origin', 'data')
    }
    const clone = join(root, 'clone')
    git(root, 'clone', '-q', origin, clone)
    return {clone, origin}
  }

  /** Pushes a further commit to `data` on the origin, as another App writer would. */
  function advanceData(origin: string): string {
    const root = mkdtempSync(join(tmpdir(), 'merge-data-writer-'))
    roots.push(root)
    git(root, 'clone', '-q', '-b', 'data', origin, 'writer')
    const writer = join(root, 'writer')
    writeFileSync(join(writer, 'later.txt'), 'later\n')
    git(writer, 'add', 'later.txt')
    git(writer, 'commit', '-q', '-m', 'data two')
    git(writer, 'push', '-q', 'origin', 'data')
    return git(writer, 'rev-parse', 'HEAD')
  }

  function runStep(script: string, cwd: string, env: Record<string, string> = {}) {
    const output = join(cwd, '..', `github-output-${String(roots.length)}`)
    writeFileSync(output, '')
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GITHUB_OUTPUT: output,
        ...env,
      },
    })
    return {status: result.status, stdout: result.stdout, stderr: result.stderr, output: readFileSync(output, 'utf8')}
  }

  it('the pin step writes the remote data tip as sha=<40 hex>', () => {
    const {clone, origin} = fixture()
    const tip = git(origin, 'rev-parse', 'refs/heads/data')
    const result = runStep(steps.find(step => step.id === 'pin')?.run ?? '', clone)
    expect(result.status).toBe(0)
    expect(result.output).toBe(`sha=${tip}\n`)
  })

  it('the pin step fails closed with a fixed error when the data ref is missing', () => {
    const {clone} = fixture(false)
    const result = runStep(steps.find(step => step.id === 'pin')?.run ?? '', clone)
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
  })

  it('the fetch step makes origin/data the pin even though data moved after the pin was read', () => {
    const {clone, origin} = fixture()
    const pinScript = steps.find(step => step.id === 'pin')?.run ?? ''
    const pinned = /sha=([0-9a-f]{40})/u.exec(runStep(pinScript, clone).output)?.[1] ?? ''
    expect(pinned).toHaveLength(40)

    const moved = advanceData(origin)
    expect(moved).not.toBe(pinned)

    const fetchScript = steps.find(step => step.name === '🔒 Fetch data ref for promotion diff')?.run ?? ''
    const result = runStep(fetchScript, clone, {PROMOTION_PIN: pinned})
    expect(result.status).toBe(0)
    expect(git(clone, 'rev-parse', 'origin/data')).toBe(pinned)
    // The leak gate's diff, `git diff origin/main...origin/data`, now sees the pin and not the later commit.
    expect(git(clone, 'diff', '--name-only', 'origin/main...origin/data')).toBe('knowledge.txt')
  })

  it('the fetch step fails when the pin is not a commit it has', () => {
    const {clone} = fixture()
    const fetchScript = steps.find(step => step.name === '🔒 Fetch data ref for promotion diff')?.run ?? ''
    const result = runStep(fetchScript, clone, {PROMOTION_PIN: 'f'.repeat(40)})
    expect(result.status).not.toBe(0)
  })
})
