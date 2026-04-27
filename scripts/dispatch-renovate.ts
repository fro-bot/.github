/**
 * Renovate dispatch engine for fro-bot repos.
 *
 * Reads metadata/renovate.yaml for the list of fro-bot repos with Renovate configs,
 * checks if their Renovate workflow is already running, and dispatches workflow_dispatch
 * for idle repos. Mirrors the bfra-me/.github central Renovate dispatch pattern.
 *
 * Architecture: pure buildDispatchPlan() + async dispatchRenovate() + thin main() shell.
 */

import type {Octokit} from '@octokit/rest'

import {readFile} from 'node:fs/promises'
import process from 'node:process'

import {parse} from 'yaml'
import {assertRenovateFile} from './schemas.ts'

export type OctokitClient = Octokit

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_WORKFLOW_ID = 'renovate.yaml'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EligibleRepo {
  owner: string
  name: string
  workflowPath: string
}

export interface DispatchRenovateParams {
  octokit: OctokitClient
  eligible: EligibleRepo[]
}

export interface DispatchRenovateResult {
  dispatched: string[]
  skippedRunning: string[]
  failed: {name: string; error: string}[]
}

// ─── Pure engine ────────────────────────────────────────────────────────────

/**
 * Build the dispatch plan from the renovate.yaml repo list.
 * Each entry is a repo name under the fro-bot owner.
 */
export function buildDispatchPlan(repoNames: string[], owner = DEFAULT_OWNER): EligibleRepo[] {
  return repoNames.map(name => ({
    owner,
    name,
    workflowPath: DEFAULT_WORKFLOW_ID,
  }))
}

// ─── Async dispatch engine ──────────────────────────────────────────────────

/**
 * For each eligible repo, check if a Renovate workflow run is already in_progress or queued.
 * If idle, dispatch a new run. Returns aggregated results.
 */
export async function dispatchRenovate(params: DispatchRenovateParams): Promise<DispatchRenovateResult> {
  const dispatched: string[] = []
  const skippedRunning: string[] = []
  const failed: DispatchRenovateResult['failed'] = []

  for (const repo of params.eligible) {
    try {
      const isActive = await isRenovateActive(params.octokit, repo)
      if (isActive) {
        skippedRunning.push(repo.name)
        continue
      }

      await params.octokit.rest.actions.createWorkflowDispatch({
        owner: repo.owner,
        repo: repo.name,
        workflow_id: repo.workflowPath,
        ref: 'main',
      })
      dispatched.push(repo.name)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error'
      failed.push({name: repo.name, error: message})
    }
  }

  return {dispatched, skippedRunning, failed}
}

/**
 * Check if a Renovate workflow is currently in_progress or queued in the target repo.
 * Checks both statuses to avoid dispatching when a run is waiting or executing.
 */
async function isRenovateActive(octokit: OctokitClient, repo: EligibleRepo): Promise<boolean> {
  for (const status of ['in_progress', 'queued'] as const) {
    const runs = await octokit.rest.actions.listWorkflowRuns({
      owner: repo.owner,
      repo: repo.name,
      workflow_id: repo.workflowPath,
      status,
      per_page: 1,
    })
    if (runs.data.total_count > 0) return true
  }
  return false
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as Record<string, unknown>).code
  return typeof code === 'string' && code === 'ENOENT'
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const {Octokit} = await import('@octokit/rest')

  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') throw new Error('GITHUB_TOKEN is required')

  const octokit = new Octokit({auth: token})

  // Read renovate.yaml for the list of fro-bot repos with Renovate
  let repoNames: string[] = []
  try {
    const raw: unknown = parse(await readFile('metadata/renovate.yaml', 'utf8'))
    assertRenovateFile(raw, 'renovate')
    repoNames = raw.repositories['with-renovate']
  } catch (error: unknown) {
    // Missing file is expected on first run — no repos to dispatch.
    // Parse/validation errors must surface so corrupted state isn't silently ignored.
    if (!isFileNotFoundError(error)) throw error
  }

  if (repoNames.length === 0) {
    process.stdout.write('{"eligible":0,"dispatched":0,"skippedRunning":0,"failed":0}\n')
    return
  }

  const eligible = buildDispatchPlan(repoNames)
  const result = await dispatchRenovate({octokit, eligible})

  for (const f of result.failed) {
    process.stderr.write(`dispatch-renovate: failed ${f.name}: ${f.error}\n`)
  }

  const summary = {
    eligible: eligible.length,
    dispatched: result.dispatched.length,
    skippedRunning: result.skippedRunning.length,
    failed: result.failed.length,
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
