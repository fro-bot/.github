import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {afterAll, describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface Step {
  name?: string
  env?: Record<string, string>
  run?: string
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/status-truth.yaml')
const parsed = parse(readFileSync(workflowPath, 'utf8')) as {jobs: {detect?: {steps: Step[]}}}
const step = parsed.jobs.detect?.steps.find(candidate => candidate.name?.includes('Load rollout snapshot'))
const script = String(step?.run ?? '')
const snapshotCli = resolve(import.meta.dirname, 'rollout-tracker-snapshot.ts')

const scratch = mkdtempSync(join(tmpdir(), 'status-truth-snapshot-step-'))
afterAll(() => {
  rmSync(scratch, {recursive: true, force: true})
})

let counter = 0
function writeConfig(keys: readonly string[]): string {
  counter += 1
  const path = join(scratch, `config-${counter}.json`)
  const programs = keys.map((key, index) => ({
    key,
    issue: `fro-bot/.github#${100 + index}`,
    project: {owner: 'fro-bot', number: 1, gateField: 'Gate'},
    operator: {id: 5, login: 'someone'},
    evidence: 'none',
  }))
  writeFileSync(path, JSON.stringify({programs}))
  return path
}

/** Runs the real snapshot CLI in place of `bun scripts/rollout-tracker-snapshot.ts`, so the step sees real exit codes. */
function runStep(env: Record<string, string>): ReturnType<typeof runStepWithStubs> {
  const real = script.replace('bun scripts/rollout-tracker-snapshot.ts', `"${process.execPath}" "${snapshotCli}"`)
  expect(real).not.toBe(script)
  return runStepWithStubs(real, {
    env: {
      ROLLOUT_TRACKER_SNAPSHOT_PATH: join(scratch, 'rollout-snapshot.json'),
      ROLLOUT_TRACKER_COMMENT_BODY: '',
      ROLLOUT_TRACKER_ITEMS_JSON: JSON.stringify([]),
      ROLLOUT_TRACKER_ISSUES_JSON: JSON.stringify([]),
      ROLLOUT_TRACKER_VISIBILITY_JSON: JSON.stringify({}),
      ROLLOUT_TRACKER_COMMENTS_JSON: '[]',
      ...env,
    },
  })
}

describe('status-truth.yaml: rollout snapshot step', () => {
  it('names the gateway program itself, so a changed default cannot move it', () => {
    expect(step?.env?.ROLLOUT_TRACKER_PROGRAM).toBe('gateway')
  })

  it('loads the snapshot when the gateway program is configured', () => {
    const result = runStep({ROLLOUT_TRACKER_PROGRAM: 'gateway', ROLLOUT_TRACKER_CONFIG: writeConfig(['gateway'])})

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('rollout-snapshot: loaded snapshot with 0 item(s)')
    expect(result.outputs.snapshot_path).toBe(join(scratch, 'rollout-snapshot.json'))
  })

  it('skips the snapshot, as a closed program, when the gateway key is absent from the config', () => {
    const result = runStep({ROLLOUT_TRACKER_PROGRAM: 'gateway', ROLLOUT_TRACKER_CONFIG: writeConfig(['other'])})

    expect(result.status).toBe(0)
    expect(result.outputs.snapshot_path).toBeUndefined()
    expect(result.stdout).toContain(
      'rollout-snapshot: program gateway is not in program-trackers.json; rollout-tracker claims are skipped',
    )
    expect(result.stdout).not.toContain('snapshot command unavailable')
  })

  it('skips the snapshot, the same way, when every program has been closed out', () => {
    const result = runStep({ROLLOUT_TRACKER_PROGRAM: 'gateway', ROLLOUT_TRACKER_CONFIG: writeConfig([])})

    expect(result.status).toBe(0)
    expect(result.outputs.snapshot_path).toBeUndefined()
    expect(result.stdout).toContain(
      'rollout-snapshot: program gateway is not in program-trackers.json; rollout-tracker claims are skipped',
    )
    expect(result.stdout).not.toContain('snapshot command unavailable')
  })

  it('reports any other failure as an unavailable snapshot', () => {
    const result = runStep({
      ROLLOUT_TRACKER_PROGRAM: 'gateway',
      ROLLOUT_TRACKER_CONFIG: join(scratch, 'absent.json'),
    })

    expect(result.status).toBe(0)
    expect(result.outputs.snapshot_path).toBeUndefined()
    expect(result.stdout).toContain(
      'rollout-snapshot: snapshot command unavailable; rollout-tracker claims will be unresolved',
    )
    expect(result.stdout).not.toContain('is not in program-trackers.json')
  })

  it('never echoes the snapshot error text', () => {
    const result = runStep({ROLLOUT_TRACKER_PROGRAM: 'gateway', ROLLOUT_TRACKER_CONFIG: writeConfig(['other'])})

    expect(result.stdout + result.stderr).not.toContain('FATAL')
  })
})
