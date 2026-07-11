/**
 * Contract tests for .github/workflows/publish-wiki.yaml and
 * unpublish-wiki.yaml: token isolation between build/deploy, SHA-pinning of
 * every `uses:`, environment separation for emergency takedown, and the
 * takedown static site's noindex directive. Style mirrors
 * improvement-metrics-workflow.test.ts.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  'continue-on-error'?: boolean
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  steps: WorkflowStep[]
  permissions?: Record<string, string>
  needs?: string | string[]
  if?: string
  environment?: {name?: string; url?: string}
}

function assertWorkflowShape(value: unknown): asserts value is {
  on: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  jobs: Record<string, WorkflowJob>
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('workflow file does not have expected shape: missing jobs object')
  }
}

const publishPath = resolve(import.meta.dirname, '../.github/workflows/publish-wiki.yaml')
const publishRaw = readFileSync(publishPath, 'utf8')
const publishParsed: unknown = parse(publishRaw)
assertWorkflowShape(publishParsed)

const unpublishPath = resolve(import.meta.dirname, '../.github/workflows/unpublish-wiki.yaml')
const unpublishRaw = readFileSync(unpublishPath, 'utf8')
const unpublishParsed: unknown = parse(unpublishRaw)
assertWorkflowShape(unpublishParsed)

function findUsesValues(raw: string): string[] {
  const matches = raw.matchAll(/uses:\s*(\S+)/gu)
  return [...matches].map(match => match[1] ?? '')
}

describe('publish-wiki.yaml workflow contract', () => {
  const buildJob = publishParsed.jobs.build
  const deployJob = publishParsed.jobs.deploy

  it('triggers on push path-filtered to knowledge/wiki/**', () => {
    const pushConfig = (publishParsed.on as {push?: {paths?: string[]}}).push
    expect(pushConfig).toBeDefined()
    expect(pushConfig?.paths).toContain('knowledge/wiki/**')
  })

  it('also supports manual dispatch', () => {
    expect(publishParsed.on).toHaveProperty('workflow_dispatch')
  })

  it('has empty top-level permissions — least privilege default', () => {
    expect(publishParsed.permissions).toEqual({})
  })

  it('serializes publishes with a static concurrency group', () => {
    expect(publishParsed.concurrency?.group).toBe('publish-wiki')
    expect(publishParsed.concurrency?.['cancel-in-progress']).toBe(false)
    expect(String(publishParsed.concurrency?.group ?? '')).not.toContain('${{')
  })

  it('build job has only contents: read — no pages or id-token', () => {
    expect(buildJob).toBeDefined()
    expect(buildJob?.permissions).toEqual({contents: 'read'})
    expect(buildJob?.permissions).not.toHaveProperty('pages')
    expect(buildJob?.permissions).not.toHaveProperty('id-token')
  })

  it('deploy job needs build, carries pages+id-token write, and uses the github-pages environment', () => {
    expect(deployJob).toBeDefined()
    expect(deployJob?.needs).toBe('build')
    expect(deployJob?.permissions).toEqual({pages: 'write', 'id-token': 'write'})
    expect(deployJob?.environment?.name).toBe('github-pages')
  })

  it('deploy job has no continue-on-error and no always()/failure()/!cancelled() escape hatches', () => {
    const forbiddenIfPatterns = [/always\(\)/u, /failure\(\)/u, /!\s*cancelled\(\)/u]
    for (const step of deployJob?.steps ?? []) {
      expect(step['continue-on-error']).toBeUndefined()
      if (typeof step.if === 'string') {
        for (const pattern of forbiddenIfPatterns) {
          expect(pattern.test(step.if)).toBe(false)
        }
      }
    }
    expect(deployJob?.if).toBeUndefined()
  })

  it('checkout step pins ref to github.sha and disables credential persistence', () => {
    const checkoutStep = buildJob?.steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )
    expect(checkoutStep).toBeDefined()
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.sha')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
    // Brand assets (icon.png) are Git LFS tracked; without lfs the build gets
    // pointer files and the Favicon (sharp) emitter fails. Guard against drift.
    expect(checkoutStep?.with?.lfs).toBe(true)
  })

  it('build step uses the local Quartz binary, never a bare npx quartz', () => {
    const buildStep = buildJob?.steps.find(
      step => typeof step.run === 'string' && step.run.includes('bootstrap-cli.mjs build'),
    )
    expect(buildStep).toBeDefined()
    expect(String(buildStep?.run ?? '')).toContain('node ./quartz/bootstrap-cli.mjs build')
    expect(String(buildStep?.run ?? '')).not.toContain('npx quartz')
  })

  it('the workflow file references the pinned Quartz v5 SHA', () => {
    expect(publishRaw).toContain('9cf87ff1c248a8ca551093214b0fec3b31415009')
    expect(publishRaw).not.toContain('4923affa7722dfc751f1074348e6dad214fe0c08')
  })

  it('overlay step copies quartz.config.yaml, not the v4 .ts config/layout files', () => {
    const overlayStep = buildJob?.steps.find(step => typeof step.run === 'string' && step.run.includes('quartz.config'))
    expect(overlayStep).toBeDefined()
    expect(String(overlayStep?.run ?? '')).toContain('quartz.config.yaml')
    expect(String(overlayStep?.run ?? '')).not.toContain('quartz.config.ts')
    expect(String(overlayStep?.run ?? '')).not.toContain('quartz.layout.ts')
  })

  it('overlay step copies the local-plugin dir and the committed lockfile', () => {
    const overlayStep = buildJob?.steps.find(
      step => typeof step.run === 'string' && step.run.includes('quartz.config.yaml'),
    )
    expect(String(overlayStep?.run ?? '')).toContain('local-plugin')
    expect(String(overlayStep?.run ?? '')).toContain('quartz.lock.json')
  })

  it('installs plugins via `plugin install` in build job, never --from-config or --latest', () => {
    const installStep = buildJob?.steps.find(
      step => typeof step.run === 'string' && step.run.includes('plugin install'),
    )
    expect(installStep).toBeDefined()
    expect(String(installStep?.run ?? '')).not.toContain('--from-config')
    expect(String(installStep?.run ?? '')).not.toContain('--latest')

    const deployInstallStep = deployJob?.steps.find(
      step => typeof step.run === 'string' && step.run.includes('plugin install'),
    )
    expect(deployInstallStep).toBeUndefined()
  })

  it('has a pre-install lockfile coverage gate before the plugin install step', () => {
    const stepNames = (buildJob?.steps ?? []).map(step => step.name ?? '')
    const coverageIndex = stepNames.findIndex(name => /lockfile coverage/iu.test(name))
    const installIndex = (buildJob?.steps ?? []).findIndex(
      step => typeof step.run === 'string' && step.run.includes('plugin install'),
    )
    expect(coverageIndex).toBeGreaterThanOrEqual(0)
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(coverageIndex).toBeLessThan(installIndex)
  })

  it('has a post-install lockfile integrity (.git/HEAD) gate before the build step', () => {
    const stepNames = (buildJob?.steps ?? []).map(step => step.name ?? '')
    const integrityIndex = stepNames.findIndex(name => /lockfile integrity/iu.test(name))
    const installIndex = (buildJob?.steps ?? []).findIndex(
      step => typeof step.run === 'string' && step.run.includes('plugin install'),
    )
    const buildIndex = (buildJob?.steps ?? []).findIndex(
      step => typeof step.run === 'string' && step.run.includes('bootstrap-cli.mjs build'),
    )
    expect(integrityIndex).toBeGreaterThanOrEqual(0)
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(buildIndex).toBeGreaterThanOrEqual(0)
    expect(installIndex).toBeLessThan(integrityIndex)
    expect(integrityIndex).toBeLessThan(buildIndex)
  })
})

describe('unpublish-wiki.yaml workflow contract', () => {
  const takedownJob = unpublishParsed.jobs.takedown

  it('is workflow_dispatch-only — no push trigger', () => {
    expect(unpublishParsed.on).toHaveProperty('workflow_dispatch')
    expect(unpublishParsed.on).not.toHaveProperty('push')
  })

  it('has empty top-level permissions', () => {
    expect(unpublishParsed.permissions).toEqual({})
  })

  it("shares publish-wiki's concurrency group but cancels in-progress runs", () => {
    expect(unpublishParsed.concurrency?.group).toBe('publish-wiki')
    expect(unpublishParsed.concurrency?.['cancel-in-progress']).toBe(true)
  })

  it('takedown job uses the pages-emergency environment, separate from github-pages', () => {
    expect(takedownJob).toBeDefined()
    expect(takedownJob?.environment?.name).toBe('pages-emergency')
    expect(takedownJob?.environment?.name).not.toBe('github-pages')
  })

  it('takedown job deploys the takedown/ path', () => {
    const uploadStep = takedownJob?.steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/upload-pages-artifact@'),
    )
    expect(uploadStep?.with?.path).toBe('takedown')
  })

  it('checkout step disables credential persistence', () => {
    const checkoutStep = takedownJob?.steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )
    expect(checkoutStep).toBeDefined()
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })
})

describe('publish-wiki + unpublish-wiki SHA pinning', () => {
  it('every `uses:` value in both workflows is pinned to a 40-hex-char commit SHA', () => {
    const usesValues = [...findUsesValues(publishRaw), ...findUsesValues(unpublishRaw)]
    expect(usesValues.length).toBeGreaterThan(0)
    for (const value of usesValues) {
      if (value.startsWith('./')) continue // local composite actions are not remote refs
      expect(value).toMatch(/@[0-9a-f]{40}$/u)
    }
  })
})

describe('takedown static site', () => {
  it('index.html is noindex,nofollow', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../takedown/index.html'), 'utf8')
    expect(html).toContain('name="robots" content="noindex,nofollow"')
  })

  it('404.html is noindex,nofollow', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../takedown/404.html'), 'utf8')
    expect(html).toContain('name="robots" content="noindex,nofollow"')
  })
})
