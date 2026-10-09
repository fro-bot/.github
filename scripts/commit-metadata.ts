import type {Octokit} from '@octokit/rest'
import {Buffer} from 'node:buffer'
import process from 'node:process'

import {parse, stringify} from 'yaml'
import {
  bootstrapDataBranch as defaultBootstrapDataBranch,
  type DataBranchBootstrapParams,
  type DataBranchBootstrapResult,
} from './data-branch-bootstrap.ts'
import {
  evaluateRenameGuard,
  lookupRepoWikiPage,
  REPOS_METADATA_PATH,
  type RenameGuardVerdict,
} from './metadata-wiki-rename-guard.ts'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_BRANCH = 'data'
const DEFAULT_MAX_RETRIES = 3

/**
 * Paths this helper is allowed to write. The helper is intentionally scoped to
 * metadata YAML only. Wiki ingest and multi-file updates must use a different
 * helper (wiki-ingest.ts uses git-based atomic commits via the Git Data API).
 */
const METADATA_PATH_PATTERN = /^metadata\/[a-z][a-z0-9-]*\.yaml$/

/**
 * Update a metadata file on the data branch with retry-on-conflict semantics.
 *
 * The helper enforces three guards by default:
 * 1. Path must match `metadata/<name>.yaml` (no arbitrary file writes).
 * 2. Branch must be `data` (no writes to main, feature branches, or anywhere else).
 * 3. Protected branches are refused except canonical `fro-bot/.github@data`.
 *
 * Writes to exactly `metadata/repos.yaml` are additionally checked by the rename guard
 * (see `metadata-wiki-rename-guard.ts`): a change that would remove a public repo name
 * while its wiki page still exists on the target branch is refused with a redacted
 * `WIKI_PAGE_RENAME_BLOCKED` (or `WIKI_STATE_UNVERIFIABLE`) error, re-checked on every retry.
 *
 * Callers that need to write outside `metadata/*.yaml` should use a different
 * helper. Callers that need to target another branch (testing only) can pass
 * `allowUnsafeBranch: true`.
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
  /**
   * Produce the next file state from the current parsed YAML.
   *
   * The mutator MUST be pure:
   * - Do not close over mutable state that could change between retries.
   * - Do not perform I/O or observable side effects.
   * - Do not mutate the input in place and return the same reference.
   *
   * Conflict retries re-invoke the mutator with a freshly-read snapshot. A
   * non-pure mutator will produce inconsistent results across retries. If the
   * mutator returns the same object reference it was given (in-place mutation),
   * the helper detects this via serialized-form comparison and fails loudly
   * rather than silently producing a no-op.
   */
  mutator: (current: unknown) => unknown | Promise<unknown>
  message: string
  octokit?: OctokitClient
  maxRetries?: number
  /**
   * Allow writing to branches other than `data`. Intended for testing only.
   * Production callers should always use the data branch.
   */
  allowUnsafeBranch?: boolean
  /**
   * Idempotent data-branch bootstrap. Called before data-branch writes so
   * shared metadata writers recover when GitHub deletes the `data` source ref
   * after a promotion PR is merged.
   */
  bootstrapDataBranch?: (params: DataBranchBootstrapParams) => Promise<DataBranchBootstrapResult>
}

export interface CommitMetadataResult {
  committed: boolean
  sha?: string
  attempts: number
}

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 *
 * Why derived, not handwritten: handwritten interfaces can declare methods that
 * don't exist on the real SDK (past bugs: `listRepositoryInvitations`, `starRepo`),
 * and can silently tighten nullability (past bug: non-null `inviter`). Deriving
 * from `Octokit` forces `tsc` to catch both classes of drift at compile time.
 *
 * The full `Octokit` type is large; callers use `as unknown as OctokitClient`
 * when constructing partial mocks in tests. That cast is acceptable because the
 * invariant we care about — SDK surface correctness — is enforced on production
 * call sites, not on mocks.
 */
export type OctokitClient = Octokit

interface FileSnapshot {
  sha: string
  parsed: unknown
  serialized: string
}

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

/**
 * Structured error with a remediation hint. Thrown for every expected failure
 * mode so callers can branch on `error.code` and surface actionable guidance.
 */
export class CommitMetadataError extends Error {
  readonly code: CommitMetadataErrorCode
  readonly remediation: string

  constructor(params: {code: CommitMetadataErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'CommitMetadataError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

export type CommitMetadataErrorCode =
  | 'INVALID_PATH'
  | 'INVALID_RETRIES'
  | 'UNSAFE_BRANCH'
  | 'PROTECTED_BRANCH'
  | 'MISSING_TOKEN'
  | 'MISSING_FILE'
  | 'INVALID_FILE'
  | 'CONFLICT_EXHAUSTED'
  | 'OCTOKIT_LOAD_FAILED'
  | 'WIKI_PAGE_RENAME_BLOCKED'
  | 'WIKI_STATE_UNVERIFIABLE'

export async function commitMetadata(params: CommitMetadataParams): Promise<CommitMetadataResult> {
  if (!METADATA_PATH_PATTERN.test(params.path)) {
    throw new CommitMetadataError({
      code: 'INVALID_PATH',
      message: `commitMetadata requires path matching ${METADATA_PATH_PATTERN}, got "${params.path}"`,
      remediation:
        'Use a path like metadata/repos.yaml. This helper only writes metadata YAML files; use a different helper for wiki or multi-file commits.',
    })
  }

  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const branch = params.branch ?? DEFAULT_BRANCH
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES

  if (maxRetries < 1) {
    throw new CommitMetadataError({
      code: 'INVALID_RETRIES',
      message: `commitMetadata requires maxRetries >= 1, got ${maxRetries}`,
      remediation: 'Pass maxRetries as a positive integer (default: 3).',
    })
  }

  if (branch !== DEFAULT_BRANCH && params.allowUnsafeBranch !== true) {
    throw new CommitMetadataError({
      code: 'UNSAFE_BRANCH',
      message: `commitMetadata refuses to write to "${branch}" (only "${DEFAULT_BRANCH}" is allowed by default)`,
      remediation: `Pass allowUnsafeBranch: true to override (testing only), or target the "${DEFAULT_BRANCH}" branch in production.`,
    })
  }

  const octokit = params.octokit ?? (await createOctokitFromEnv())

  const shouldBootstrapDataBranch = branch === DEFAULT_BRANCH
  const bootstrap = params.bootstrapDataBranch ?? defaultBootstrapDataBranch
  const bootstrapDataBranch = async (): Promise<void> => {
    await bootstrap({octokit, owner, repo, dataBranch: branch})
  }

  if (shouldBootstrapDataBranch) {
    await bootstrapDataBranch()
  }

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await assertWritableBranch(octokit, owner, repo, branch)

      const current = await readExistingMetadataFile({
        octokit,
        owner,
        repo,
        branch,
        path: params.path,
      })

      const next = await params.mutator(current.parsed)
      const nextSerialized = serializeYaml(next)

      // Authoritative unchanged-content check: compare serialized text, not
      // deep-equal on objects. This catches (a) in-place mutations that return
      // the same reference, (b) key-order or whitespace changes that would
      // otherwise commit identical data.
      if (nextSerialized === current.serialized) {
        return {committed: false, attempts: attempt}
      }

      // Re-evaluated on every attempt against the freshly read snapshot and branch tree: a wiki
      // page can appear between a 409 and the retry, and only verified absence permits a rename.
      if (params.path === REPOS_METADATA_PATH) {
        const verdict = await evaluateRenameGuard({
          previous: current.parsed,
          next,
          lookup: async slug => lookupRepoWikiPage({octokit, owner, repo, branch, slug}),
        })
        assertRenameAllowed(verdict)
      }

      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        branch,
        path: params.path,
        message: params.message,
        sha: current.sha,
        content: Buffer.from(nextSerialized, 'utf8').toString('base64'),
      })

      return {
        committed: true,
        sha: response.data.commit.sha,
        attempts: attempt,
      }
    } catch (error: unknown) {
      if (shouldBootstrapDataBranch && isRecoverableDataBranchMissingError(error) && attempt < maxRetries) {
        await bootstrapDataBranch()
        continue
      }

      if (isConflictError(error) && attempt < maxRetries) {
        continue
      }

      if (isConflictError(error)) {
        throw new CommitMetadataError({
          code: 'CONFLICT_EXHAUSTED',
          message: `commitMetadata exhausted ${maxRetries} attempt(s) updating ${params.path} on ${owner}/${repo}@${branch}`,
          remediation:
            'Another writer is contending on the same file. Increase maxRetries, serialize writes via concurrency groups, or investigate the concurrent caller.',
        })
      }

      throw error
    }
  }

  throw new Error('commitMetadata reached an unreachable retry state')
}

/**
 * Convert a blocking rename-guard verdict into a redacted `CommitMetadataError`. Messages carry
 * counts only: this error surfaces in public workflow logs, so no repo name, slug, or wiki path
 * may appear in it (and no `cause`, since API errors embed the request path).
 */
function assertRenameAllowed(verdict: RenameGuardVerdict): void {
  if (verdict.kind === 'allow') {
    return
  }

  if (verdict.kind === 'page-present') {
    throw new CommitMetadataError({
      code: 'WIKI_PAGE_RENAME_BLOCKED',
      message: `commitMetadata blocked a ${REPOS_METADATA_PATH} change that would remove ${verdict.count} public repository name(s) whose wiki page still exists on the data branch`,
      remediation:
        'Repair the old wiki page through an operator-approved, App-backed data-branch wiki write (redirect references to the canonical page, then delete the old page), then rerun the writer. Do not bypass the promotion privacy gate.',
    })
  }

  throw new CommitMetadataError({
    code: 'WIKI_STATE_UNVERIFIABLE',
    message: `commitMetadata blocked a ${REPOS_METADATA_PATH} change: could not verify wiki page state for ${verdict.count} removed public repository name(s)`,
    remediation:
      'The data-branch wiki tree could not be read or was ambiguous. Check GitHub API health and token permissions, then rerun the writer; the change is refused until absence of the old page is verified.',
  })
}

/**
 * Recursive structural equality. Handles arrays, plain records, primitives,
 * and circular references (via WeakSet cycle detection).
 *
 * Exported for callers that need a defensive equality check. The main commit
 * path uses serialized-form comparison (see commitMetadata above), which is
 * more robust because it mirrors what actually gets written to the API.
 */
export function deepEquals(left: unknown, right: unknown): boolean {
  return deepEqualsInternal(left, right, new WeakSet(), new WeakSet())
}

function deepEqualsInternal(
  left: unknown,
  right: unknown,
  leftSeen: WeakSet<object>,
  rightSeen: WeakSet<object>,
): boolean {
  if (Object.is(left, right)) {
    return true
  }

  // Cycle detection: if we've already visited either object on its respective
  // side of the comparison, treat as equal (walking the same shape twice).
  if (typeof left === 'object' && left !== null) {
    if (leftSeen.has(left)) {
      return typeof right === 'object' && right !== null && rightSeen.has(right)
    }
    leftSeen.add(left)
  }
  if (typeof right === 'object' && right !== null) {
    if (rightSeen.has(right)) {
      return false
    }
    rightSeen.add(right)
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false
    }

    if (left.length !== right.length) {
      return false
    }

    return left.every((value, index) => deepEqualsInternal(value, right[index], leftSeen, rightSeen))
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

    // Explicitly check that right has every key on the left — prevents the
    // false-positive where {a:undefined} and {b:undefined} compare equal under
    // a length-only check.
    if (!leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key))) {
      return false
    }

    return leftKeys.every(key => deepEqualsInternal(left[key], right[key], leftSeen, rightSeen))
  }

  return false
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN

  if (token === undefined || token === '') {
    throw new CommitMetadataError({
      code: 'MISSING_TOKEN',
      message: 'commitMetadata requires params.octokit or GITHUB_TOKEN in the environment',
      remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
    })
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
    throw new CommitMetadataError({
      code: 'PROTECTED_BRANCH',
      message: 'commitMetadata refuses to write to main; use the data branch',
      remediation: 'Target the data branch. Merges to main go through the weekly data-branch merge PR.',
    })
  }

  const response = await octokit.rest.repos.getBranch({owner, repo, branch})

  // Check both the top-level `protected` boolean and the nested `protection.enabled`
  // field. GitHub's REST API surfaces branch protection via both; older clients
  // only check the latter, which misses repos configured via the newer rulesets API.
  if (
    (response.data.protected === true || response.data.protection?.enabled === true) &&
    !(owner === DEFAULT_OWNER && repo === DEFAULT_REPO && branch === DEFAULT_BRANCH)
  ) {
    throw new CommitMetadataError({
      code: 'PROTECTED_BRANCH',
      message: `commitMetadata refuses to write to protected branch "${branch}"`,
      remediation:
        'Target the canonical fro-bot/.github data branch or another unprotected branch. Review the ruleset and branch protection if this target should be writable.',
    })
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
      throw new CommitMetadataError({
        code: 'INVALID_FILE',
        message: `Metadata path "${params.path}" is not a file`,
        remediation: 'Ensure the path points at a single YAML file, not a directory or symlink.',
      })
    }

    if (typeof file.content !== 'string' || file.encoding !== 'base64') {
      throw new CommitMetadataError({
        code: 'INVALID_FILE',
        message: `Metadata file "${params.path}" must be returned as base64 content`,
        remediation:
          'Files over 1 MB are not base64-encoded by the Contents API. Metadata files are expected to be small; if this is legitimate, use the Git blobs API.',
      })
    }

    const serialized = Buffer.from(file.content, 'base64').toString('utf8')

    return {
      sha: file.sha,
      parsed: parse(serialized),
      serialized,
    }
  } catch (error: unknown) {
    if (error instanceof CommitMetadataError) {
      throw error
    }

    if (isRecord(error) && typeof error.status === 'number' && error.status === 404) {
      throw new CommitMetadataError({
        code: 'MISSING_FILE',
        message: `Metadata file "${params.path}" does not exist on ${params.owner}/${params.repo}@${params.branch}`,
        remediation:
          'Initialize the file on main first (with the expected schema), then ensure the data branch has been bootstrapped from main. commitMetadata only updates existing files.',
      })
    }

    throw error
  }
}

function serializeYaml(value: unknown): string {
  const serialized = stringify(value, {
    indent: 2,
    lineWidth: 0,
    singleQuote: true,
  })

  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}

function isConflictError(error: unknown): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === 409
}

function isApiErrorStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status
}

function isRecoverableDataBranchMissingError(error: unknown): boolean {
  return isApiErrorStatus(error, 404) || (error instanceof CommitMetadataError && error.code === 'MISSING_FILE')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  const loaded: unknown = await import('@octokit/rest')

  if (!isRecord(loaded) || !('Octokit' in loaded)) {
    throw new CommitMetadataError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }

  const octokit = loaded.Octokit

  if (typeof octokit !== 'function') {
    throw new TypeError('Invalid @octokit/rest Octokit export')
  }

  // Safe cast: the preceding type guards verify `octokit` is a function exported
  // under the `Octokit` key of @octokit/rest. We narrow the broader public
  // Octokit constructor signature to the `OctokitClient` subset this module uses.
  return octokit as OctokitConstructor
}
