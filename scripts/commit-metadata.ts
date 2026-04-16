import {Buffer} from 'node:buffer'
import process from 'node:process'

import {parse, stringify} from 'yaml'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_BRANCH = 'data'
const DEFAULT_MAX_RETRIES = 3

/**
 * Update a metadata file on the data branch with retry-on-conflict semantics.
 *
 * @example
 * import {commitMetadata} from './commit-metadata.ts'
 *
 * await commitMetadata({
 *   path: 'metadata/repos.yaml',
 *   message: 'chore(metadata): mark onboarding complete',
 *   async mutator(current) {
 *     return current
 *   },
 * })
 */
export interface CommitMetadataParams {
  path: string
  owner?: string
  repo?: string
  branch?: string
  mutator: (current: unknown) => unknown | Promise<unknown>
  message: string
  octokit?: OctokitClient
  maxRetries?: number
}

export interface CommitMetadataResult {
  committed: boolean
  sha?: string
  attempts: number
}

export interface OctokitClient {
  rest: {
    repos: {
      getBranch: (params: {owner: string; repo: string; branch: string}) => Promise<{
        data: {
          name: string
          protection?: {
            enabled?: boolean
          }
        }
      }>
      getContent: (params: {owner: string; repo: string; ref: string; path: string}) => Promise<{
        data: FileContentResponse | unknown[]
      }>
      createOrUpdateFileContents: (params: {
        owner: string
        repo: string
        branch: string
        path: string
        message: string
        sha: string
        content: string
      }) => Promise<{
        data: {
          commit: {
            sha: string
          }
        }
      }>
    }
  }
}

interface FileContentResponse {
  type: 'file'
  sha: string
  content?: string
  encoding?: string
}

interface FileSnapshot {
  sha: string
  parsed: unknown
}

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

export async function commitMetadata(params: CommitMetadataParams): Promise<CommitMetadataResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const branch = params.branch ?? DEFAULT_BRANCH
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES
  const octokit = params.octokit ?? (await createOctokitFromEnv())

  if (maxRetries < 1) {
    throw new Error('commitMetadata requires maxRetries >= 1')
  }

  await assertWritableBranch(octokit, owner, repo, branch)

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const current = await readExistingMetadataFile({
      octokit,
      owner,
      repo,
      branch,
      path: params.path,
    })

    const next = await params.mutator(current.parsed)

    if (deepEquals(current.parsed, next)) {
      return {committed: false, attempts: attempt}
    }

    try {
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        branch,
        path: params.path,
        message: params.message,
        sha: current.sha,
        content: Buffer.from(serializeYaml(next), 'utf8').toString('base64'),
      })

      return {
        committed: true,
        sha: response.data.commit.sha,
        attempts: attempt,
      }
    } catch (error: unknown) {
      if (isConflictError(error) && attempt < maxRetries) {
        continue
      }

      if (isConflictError(error)) {
        throw new Error(
          `commitMetadata exhausted ${maxRetries} attempt(s) updating ${params.path} on ${owner}/${repo}@${branch}`,
        )
      }

      throw error
    }
  }

  throw new Error('commitMetadata reached an unreachable retry state')
}

export function deepEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false
    }

    if (left.length !== right.length) {
      return false
    }

    return left.every((value, index) => deepEquals(value, right[index]))
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return false
    }

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)

    if (leftKeys.length !== rightKeys.length) {
      return false
    }

    return leftKeys.every(key => deepEquals(left[key], right[key]))
  }

  return false
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN

  if (token === undefined || token === '') {
    throw new Error('commitMetadata requires params.octokit or GITHUB_TOKEN in the environment')
  }

  const Octokit = await loadOctokitConstructor()

  return new Octokit({auth: token})
}

async function assertWritableBranch(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  if (branch === 'main') {
    throw new Error('commitMetadata refuses to write to main; use the data branch')
  }

  const response = await octokit.rest.repos.getBranch({owner, repo, branch})

  if (response.data.protection?.enabled) {
    throw new Error(`commitMetadata refuses to write to protected branch "${branch}"`)
  }
}

async function readExistingMetadataFile(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  branch: string
  path: string
}): Promise<FileSnapshot> {
  try {
    const response = await params.octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      ref: params.branch,
      path: params.path,
    })

    const file = response.data

    if (Array.isArray(file) || file.type !== 'file') {
      throw new Error(`Metadata path "${params.path}" is not a file`)
    }

    if (typeof file.content !== 'string' || file.encoding !== 'base64') {
      throw new Error(`Metadata file "${params.path}" must be returned as base64 content`)
    }

    return {
      sha: file.sha,
      parsed: parse(Buffer.from(file.content, 'base64').toString('utf8')),
    }
  } catch (error: unknown) {
    if (isRecord(error) && typeof error.status === 'number' && error.status === 404) {
      throw new Error(
        `Metadata file "${params.path}" does not exist on ${params.owner}/${params.repo}@${params.branch}; initialize it before calling commitMetadata`,
      )
    }

    throw error
  }
}

function serializeYaml(value: unknown): string {
  const serialized = stringify(value, {
    indent: 2,
    lineWidth: 0,
  })

  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}

function isConflictError(error: unknown): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === 409
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  const loaded: unknown = await import('@octokit/rest')

  if (!isRecord(loaded) || !('Octokit' in loaded)) {
    throw new Error('Failed to load @octokit/rest Octokit constructor')
  }

  const octokit = loaded.Octokit

  if (typeof octokit !== 'function') {
    throw new TypeError('Invalid @octokit/rest Octokit export')
  }

  return octokit as OctokitConstructor
}
