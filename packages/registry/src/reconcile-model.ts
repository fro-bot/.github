/**
 * The shared vocabulary of the reconcile seams: the structured `ReconcileError`, the logger shape, the
 * Octokit client type, the `toApiError` wrapper, and the owner, repo and metadata-path defaults that both
 * the handler and the CLI read. A leaf: it imports no other seam.
 */

import type {Octokit} from '@octokit/rest'

//
// ─────────────────────────────────────────────────────────────────────────────
// Unit 3 — I/O shell: `handleReconcile` plus dispatch/issue/integrity helpers
// ─────────────────────────────────────────────────────────────────────────────
//

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit

export const DEFAULT_OWNER = 'fro-bot'

export const DEFAULT_REPO = '.github'

export const DEFAULT_ALLOWLIST_PATH = 'metadata/allowlist.yaml'

export const DEFAULT_REPOS_PATH = 'metadata/repos.yaml'

export type ReconcileErrorCode =
  'MISSING_TOKEN' | 'OCTOKIT_LOAD_FAILED' | 'METADATA_READ_ERROR' | 'COMMIT_ERROR' | 'DATA_BRANCH_TAMPER' | 'API_ERROR'

/**
 * Structured error with a remediation hint. Thrown for every expected failure mode on
 * the top-level path. Matches the shape of `CommitMetadataError` /
 * `InvitationHandlingError` / `DataBranchBootstrapError`.
 */
export class ReconcileError extends Error {
  readonly code: ReconcileErrorCode
  readonly remediation: string

  constructor(params: {code: ReconcileErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'ReconcileError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

export interface ReconcileLogger {
  warn: (message: string) => void
  info: (message: string) => void
}

export function toApiError(error: unknown, action: string): ReconcileError {
  if (error instanceof ReconcileError) return error
  const message = error instanceof Error ? error.message : `Unknown error while ${action}`
  return new ReconcileError({
    code: 'API_ERROR',
    message: `GitHub API error while ${action}: ${message}`,
    remediation: 'Retry once. If the failure persists, inspect GitHub API status and repository permissions.',
  })
}
