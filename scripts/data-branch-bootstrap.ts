import process from 'node:process'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_MAIN_BRANCH = 'main'
const DEFAULT_DATA_BRANCH = 'data'

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

export interface DataBranchBootstrapParams {
  owner?: string
  repo?: string
  mainBranch?: string
  dataBranch?: string
  octokit?: OctokitClient
}

export interface DataBranchBootstrapResult {
  created: boolean
  ref: string
  sha: string
}

export interface OctokitClient {
  rest: {
    repos: {
      getBranch: (params: {owner: string; repo: string; branch: string}) => Promise<{
        data: {
          name: string
          commit: {
            sha: string
          }
        }
      }>
    }
    git: {
      createRef: (params: {owner: string; repo: string; ref: string; sha: string}) => Promise<{
        data: {
          ref: string
        }
      }>
    }
  }
}

export type DataBranchBootstrapErrorCode =
  | 'MISSING_TOKEN'
  | 'OCTOKIT_LOAD_FAILED'
  | 'MAIN_BRANCH_NOT_FOUND'
  | 'API_ERROR'

export class DataBranchBootstrapError extends Error {
  readonly code: DataBranchBootstrapErrorCode
  readonly remediation: string

  constructor(params: {code: DataBranchBootstrapErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'DataBranchBootstrapError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

export async function bootstrapDataBranch(params: DataBranchBootstrapParams = {}): Promise<DataBranchBootstrapResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const mainBranch = params.mainBranch ?? DEFAULT_MAIN_BRANCH
  const dataBranch = params.dataBranch ?? DEFAULT_DATA_BRANCH
  const octokit = params.octokit ?? (await createOctokitFromEnv())

  try {
    const existing = await octokit.rest.repos.getBranch({owner, repo, branch: dataBranch})

    return {
      created: false,
      ref: `refs/heads/${existing.data.name}`,
      sha: existing.data.commit.sha,
    }
  } catch (error: unknown) {
    if (!isApiErrorStatus(error, 404)) {
      throw toBootstrapApiError(error, `checking whether ${dataBranch} exists`)
    }
  }

  let main: Awaited<ReturnType<OctokitClient['rest']['repos']['getBranch']>>
  try {
    main = await octokit.rest.repos.getBranch({owner, repo, branch: mainBranch})
  } catch (error: unknown) {
    if (isApiErrorStatus(error, 404)) {
      throw new DataBranchBootstrapError({
        code: 'MAIN_BRANCH_NOT_FOUND',
        message: `Cannot bootstrap ${dataBranch}: base branch ${mainBranch} was not found in ${owner}/${repo}`,
        remediation: `Create or restore the ${mainBranch} branch before bootstrapping the ${dataBranch} branch.`,
      })
    }

    throw toBootstrapApiError(error, `reading ${mainBranch} branch head`)
  }

  try {
    const response = await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${dataBranch}`,
      sha: main.data.commit.sha,
    })

    return {
      created: true,
      ref: response.data.ref,
      sha: main.data.commit.sha,
    }
  } catch (error: unknown) {
    throw toBootstrapApiError(error, `creating ${dataBranch} from ${mainBranch}`)
  }
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN

  if (token === undefined || token === '') {
    throw new DataBranchBootstrapError({
      code: 'MISSING_TOKEN',
      message: 'bootstrapDataBranch requires params.octokit or GITHUB_TOKEN in the environment',
      remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
    })
  }

  const Octokit = await loadOctokitConstructor()

  return new Octokit({auth: token})
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  const loaded: unknown = await import('@octokit/rest')

  if (!isRecord(loaded) || !('Octokit' in loaded)) {
    throw new DataBranchBootstrapError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }

  const octokit = loaded.Octokit

  if (typeof octokit !== 'function') {
    throw new TypeError('Invalid @octokit/rest Octokit export')
  }

  return octokit as OctokitConstructor
}

function toBootstrapApiError(error: unknown, action: string): DataBranchBootstrapError {
  const message = error instanceof Error ? error.message : `Unknown error while ${action}`

  return new DataBranchBootstrapError({
    code: 'API_ERROR',
    message: `GitHub API error while ${action}: ${message}`,
    remediation: 'Retry once. If the failure persists, inspect the repository permissions and GitHub API status.',
  })
}

function isApiErrorStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function main(): Promise<void> {
  const result = await bootstrapDataBranch()
  const action = result.created ? 'created' : 'exists'
  process.stdout.write(`${action}:${result.ref}:${result.sha}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
