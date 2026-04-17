import type {Octokit} from '@octokit/rest'
import {Buffer} from 'node:buffer'
import process from 'node:process'

import {parse, stringify} from 'yaml'

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
 * 3. Branch must not be protected at the time of the pre-flight check.
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
    const nextSerialized = serializeYaml(next)

    // Authoritative unchanged-content check: compare serialized text, not
    // deep-equal on objects. This catches (a) in-place mutations that return
    // the same reference, (b) key-order or whitespace changes that would
    // otherwise commit identical data.
    if (nextSerialized === current.serialized) {
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
        content: Buffer.from(nextSerialized, 'utf8').toString('base64'),
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
  if (response.data.protected === true || response.data.protection?.enabled === true) {
    throw new CommitMetadataError({
      code: 'PROTECTED_BRANCH',
      message: `commitMetadata refuses to write to protected branch "${branch}"`,
      remediation:
        'Autonomous writes must land on an unprotected branch (the data branch). If this branch became protected unexpectedly, review the ruleset and branch protection configuration.',
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
