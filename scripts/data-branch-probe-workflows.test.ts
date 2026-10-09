/**
 * Repo-wide contract for every workflow step that probes the `data` branch with
 * `git ls-remote --exit-code origin data`.
 *
 * `ls-remote --exit-code` exits 2 only when the ref does not exist; any other nonzero exit (128:
 * transport, authentication) means the probe itself failed. Treating that like "branch absent"
 * silently runs the privacy gate, the registry gate, or reconcile against stale `metadata/` from
 * main. So an overlay step must: overlay on 0, skip on 2, and fail naming the exit code otherwise.
 *
 * The steps are discovered by scanning `.github/workflows/`, never listed here, so a new copy of
 * the probe is covered the day it lands. A step whose purpose is not to overlay must be listed in
 * {@link EXEMPT_STEPS} with its reason, and is held to its own behavior instead.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

import {overlayWasAttempted, runStepWithStubs} from './workflow-step-test-helper.ts'

const WORKFLOWS_DIR = resolve(import.meta.dirname, '../.github/workflows')

interface ProbeStep {
  /** `<workflow file>#<job>#<step name>`; stable and unique enough to key on. */
  key: string
  file: string
  job: string
  name: string
  run: string
}

const PROBE = /git\s+ls-remote.*\sorigin\s+data\b/
/** The pre-fix shape: any probe failure falls into the else branch as if the branch were absent. */
const OLD_FORM = /\bif\s+git\s+ls-remote\s+--exit-code\s+origin\s+data\b/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function discoverProbeSteps(): ProbeStep[] {
  const found: ProbeStep[] = []
  for (const file of readdirSync(WORKFLOWS_DIR)
    .filter(name => /\.ya?ml$/.test(name))
    .sort()) {
    const workflow: unknown = parse(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) continue
    for (const [job, definition] of Object.entries(workflow.jobs)) {
      if (!isRecord(definition) || !Array.isArray(definition.steps)) continue
      for (const step of definition.steps as unknown[]) {
        if (!isRecord(step) || typeof step.run !== 'string' || !PROBE.test(step.run)) continue
        const name = typeof step.name === 'string' ? step.name : '(unnamed)'
        found.push({key: `${file}#${job}#${name}`, file, job, name, run: step.run})
      }
    }
  }
  return found
}

/**
 * Steps that probe `data` but do not overlay. Each is held to its own fail-closed behavior below.
 * Adding to this list is a deliberate decision: say why.
 */
const EXEMPT_STEPS: Record<string, string> = {
  'wiki-lint.yaml#wiki-lint#Restore wiki from data branch':
    'restores the wiki snapshot to lint; the branch being absent is as fatal as the probe failing, so it fails on both',
}

const steps = discoverProbeSteps()
const overlaySteps = steps.filter(step => !(step.key in EXEMPT_STEPS))
const exemptSteps = steps.filter(step => step.key in EXEMPT_STEPS)

describe('data-branch probe discovery', () => {
  it('finds every probe in the workflows, not an empty or partial set', () => {
    // 14 legacy copies across 9 workflows plus draft-solutions.yaml.
    expect(steps.length).toBeGreaterThanOrEqual(15)
    expect(new Set(steps.map(step => step.file)).size).toBeGreaterThanOrEqual(10)
  })

  it('every exemption still exists, so the list cannot rot', () => {
    expect(exemptSteps.map(step => step.key).sort()).toStrictEqual(Object.keys(EXEMPT_STEPS).sort())
  })

  it('no workflow keeps the old tolerant `if git ls-remote --exit-code origin data` form, except the exempt steps', () => {
    const oldForm = steps.filter(step => OLD_FORM.test(step.run)).map(step => step.key)
    expect(oldForm.sort()).toStrictEqual(Object.keys(EXEMPT_STEPS).sort())
  })

  it('every overlay step captures the probe exit code and dispatches on it', () => {
    for (const step of overlaySteps) {
      expect(step.run, step.key).toMatch(
        /status=0[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*git ls-remote --exit-code origin data >\/dev\/null \|\| status=\$\?/,
      )
      expect(step.run, step.key).toContain('case "$status" in')
    }
  })
})

describe.each(overlaySteps.map(step => [step.key, step] as const))('%s', (_key, step) => {
  it('exit 0 (branch present): overlays', () => {
    const result = runStepWithStubs(step.run, {lsRemoteExit: 0})

    expect(result.status).toBe(0)
    expect(result.trace.some(line => line.startsWith('git fetch'))).toBe(true)
    expect(result.trace.some(line => /^git (?:checkout|restore)\b/.test(line))).toBe(true)
  })

  it('exit 2 (branch absent): skips and succeeds without fetching', () => {
    const result = runStepWithStubs(step.run, {lsRemoteExit: 2})

    expect(result.status).toBe(0)
    expect(overlayWasAttempted(result.trace)).toBe(false)
  })

  it.each([128, 1, 255])('exit %i (probe failed): fails naming the exit code, with no overlay', (code: number) => {
    const result = runStepWithStubs(step.run, {lsRemoteExit: code})

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('::error::')
    expect(result.stdout).toContain(String(code))
    expect(overlayWasAttempted(result.trace)).toBe(false)
    // Nothing downstream of a failed probe may run (e.g. the onboarded gate's node script).
    expect(result.trace.some(line => line.startsWith('node'))).toBe(false)
  })
})

describe('exit 2 skip messages are unchanged', () => {
  it('every overlay step that announced a skip still announces it', () => {
    const silentByDesign = new Set(['survey-repo.yaml#survey-repo#Check repo onboarded'])
    for (const step of overlaySteps.filter(candidate => !silentByDesign.has(candidate.key))) {
      const result = runStepWithStubs(step.run, {lsRemoteExit: 2})
      expect(result.stdout, step.key).toMatch(
        /data branch not yet established; (?:skipping metadata overlay|reconcile will bootstrap it)\./,
      )
    }
  })

  it('reconcile-repos keeps its bootstrap wording, because exit 2 is when it bootstraps', () => {
    const reconcile = steps.find(step => step.file === 'reconcile-repos.yaml')
    expect(reconcile).toBeDefined()
    const result = runStepWithStubs(reconcile?.run ?? '', {lsRemoteExit: 2})
    expect(result.stdout).toContain('data branch not yet established; reconcile will bootstrap it.')
  })
})

describe('survey-repo onboarded gate keeps running its check after a successful probe or an absent branch', () => {
  const survey = steps.find(step => step.file === 'survey-repo.yaml')

  it.each([0, 2])('probe exit %i: runs the onboarded check', (code: number) => {
    const result = runStepWithStubs(survey?.run ?? '', {lsRemoteExit: code})

    expect(result.status).toBe(0)
    expect(result.trace).toContain('node scripts/check-repo-onboarded.ts')
  })
})

describe.each(exemptSteps.map(step => [step.key, step] as const))('exempt: %s', (_key, step) => {
  it('exit 0: restores the snapshot', () => {
    const result = runStepWithStubs(step.run, {lsRemoteExit: 0})

    expect(result.status).toBe(0)
    expect(result.trace.some(line => line.startsWith('git fetch'))).toBe(true)
    expect(result.trace.some(line => line.startsWith('git restore'))).toBe(true)
  })

  it.each([2, 128])('exit %i: fails (absent and failed are both fatal), restoring nothing', (code: number) => {
    const result = runStepWithStubs(step.run, {lsRemoteExit: code})

    expect(result.status).not.toBe(0)
    expect(overlayWasAttempted(result.trace)).toBe(false)
  })
})

describe('test environment', () => {
  it('runs bash from the stubbed PATH without the real git on the stub path', () => {
    // Guards the harness itself: a real `git` leaking in would make every case above meaningless.
    const result = runStepWithStubs('git ls-remote --exit-code origin data; echo "rc=$?"', {lsRemoteExit: 7})

    expect(result.stdout).toContain('rc=7')
    expect(result.trace).toStrictEqual(['git ls-remote --exit-code origin data'])
    expect(process.env.STUB_GIT_LS_REMOTE_EXIT).toBeUndefined()
  })
})
