/**
 * Metadata refresh for the fro-bot org.
 *
 * Scans the fro-bot org for repositories containing `.github/workflows/renovate.yaml`
 * and writes the sorted list to `metadata/renovate.yaml` on the `data` branch.
 * Mirrors the bfra-me/.github update-metadata pattern.
 *
 * Architecture:
 *   - buildRenovateFile(names): pure shape builder — sole owner of sort + dedupe.
 *   - discoverRenovateRepos(octokit, org): async I/O — list org repos, probe each.
 *     Returns repos in discovery order; canonicalization happens in buildRenovateFile.
 *   - main(): thin shell — token, octokit, discover, commitMetadata.
 */

import type {Octokit, RestEndpointMethodTypes} from '@octokit/rest'
import type {RenovateFile} from './schemas.ts'

import process from 'node:process'

import {commitMetadata} from './commit-metadata.ts'

export type OctokitClient = Octokit

const DEFAULT_ORG = 'fro-bot'
const RENOVATE_WORKFLOW_PATH = '.github/workflows/renovate.yaml'
const RENOVATE_METADATA_PATH = 'metadata/renovate.yaml'

// Derived from the real Octokit response so SDK drift becomes a compile error.
type OrgRepoListing = RestEndpointMethodTypes['repos']['listForOrg']['response']['data'][number]

// ─── Pure engine ────────────────────────────────────────────────────────────

/**
 * Wrap a list of repo names in the canonical `metadata/renovate.yaml` schema.
 * Sorts alphabetically and deduplicates so the file shape is stable.
 */
export function buildRenovateFile(repoNames: string[]): RenovateFile {
  const unique = [...new Set(repoNames)]
  unique.sort((a, b) => a.localeCompare(b))
  return {repositories: {'with-renovate': unique}}
}

// ─── Async discovery engine ─────────────────────────────────────────────────

/**
 * Discover org repos that contain a Renovate workflow at the canonical path.
 * Skips archived repos and forks (neither should be receiving Renovate dispatches).
 * 404 from the probe means "no Renovate workflow"; non-404 errors propagate with
 * repo context so failures point at the offending repo.
 */
export async function discoverRenovateRepos(octokit: OctokitClient, org: string): Promise<string[]> {
  const repos: OrgRepoListing[] = await octokit.paginate(octokit.rest.repos.listForOrg, {
    org,
    type: 'all',
    per_page: 100,
  })

  const found: string[] = []

  for (const repo of repos) {
    if (repo.archived || repo.fork) continue

    try {
      await octokit.rest.repos.getContent({
        owner: org,
        repo: repo.name,
        path: RENOVATE_WORKFLOW_PATH,
      })
      found.push(repo.name)
    } catch (error: unknown) {
      if (isNotFoundError(error)) continue
      throw new Error(`update-metadata: probe failed for ${org}/${repo.name} (${formatErrorStatus(error)})`, {
        cause: error,
      })
    }
  }

  return found
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasNumericStatus(error: unknown): error is {status: number} {
  if (typeof error !== 'object' || error === null) return false
  const status = (error as {status?: unknown}).status
  return typeof status === 'number'
}

function isNotFoundError(error: unknown): boolean {
  return hasNumericStatus(error) && error.status === 404
}

function formatErrorStatus(error: unknown): string {
  if (hasNumericStatus(error)) return `status=${error.status}`
  if (error instanceof Error) return error.message
  return 'unknown error'
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const {Octokit} = await import('@octokit/rest')

  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') throw new Error('GITHUB_TOKEN is required')

  const octokit = new Octokit({auth: token})
  const org = process.env.UPDATE_METADATA_ORG ?? DEFAULT_ORG

  const detected = await discoverRenovateRepos(octokit, org)
  const next = buildRenovateFile(detected)

  const result = await commitMetadata({
    path: RENOVATE_METADATA_PATH,
    message: `chore(metadata): refresh renovate.yaml from ${org} org scan`,
    octokit,
    async mutator() {
      return next
    },
  })

  const summary = {
    org,
    detected: detected.length,
    committed: result.committed,
    attempts: result.attempts,
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
