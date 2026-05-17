import {appendFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import process from 'node:process'

import {Octokit} from '@octokit/rest'
import {parse} from 'yaml'

import {commitMetadata, type CommitMetadataParams, type CommitMetadataResult} from './commit-metadata.ts'
import {bootstrapDataBranch, type DataBranchBootstrapParams} from './data-branch-bootstrap.ts'
import {addRepoEntry} from './repos-metadata.ts'
import {assertAllowlistFile, assertReposFile, SchemaValidationError, type ReposFile} from './schemas.ts'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_ALLOWLIST_PATH = 'metadata/allowlist.yaml'
const DEFAULT_REPOS_PATH = 'metadata/repos.yaml'
const DEFAULT_WORKFLOW_FILE = 'survey-repo.yaml'
const DEFAULT_WORKFLOW_REF = 'main'

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

export interface RepositoryInvitation {
  id: number
  /**
   * GitHub's schema types inviter as `nullable-simple-user` — it can be `null` when the inviting
   * user account has been deleted. Always guard before dereferencing `inviter.login`.
   */
  inviter: {
    login: string
  } | null
  repository: {
    name: string
    node_id?: unknown
    private?: unknown
    owner: {
      login: string
    }
  }
}

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit

export interface HandleInvitationsParams {
  octokit?: OctokitClient
  owner?: string
  repo?: string
  allowlistPath?: string
  reposPath?: string
  workflowFile?: string
  workflowRef?: string
  now?: Date
  readMetadata?: (path: string) => Promise<unknown>
  commitMetadata?: (params: CommitMetadataParams) => Promise<CommitMetadataResult>
  /** Idempotent data branch bootstrap. Called once per run before any metadata writes. */
  bootstrapDataBranch?: (params: DataBranchBootstrapParams) => Promise<unknown>
}

export interface HandleInvitationsResult {
  processed: InvitationProcessResult[]
}

export type InvitationProcessResult = AcceptedInvitationResult | SkippedInvitationResult | FailedInvitationResult

export interface AcceptedInvitationResult {
  invitationId: number
  inviter: string
  owner: string
  repo: string
  status: 'accepted'
}

export interface SkippedInvitationResult {
  invitationId: number
  inviter: string | null
  owner: string
  repo: string
  status: 'skipped'
  reason: 'inviter-not-allowlisted' | 'inviter-unknown'
}

export interface FailedInvitationResult {
  invitationId: number
  inviter: string
  owner: string
  repo: string
  status: 'failed'
  errorCode: InvitationHandlingErrorCode | 'API_ERROR'
  message: string
}

export type InvitationHandlingErrorCode =
  | 'MISSING_TOKEN'
  | 'OCTOKIT_LOAD_FAILED'
  | 'INVALID_ALLOWLIST'
  | 'INVALID_REPOS'
  | 'CREDENTIALS_ERROR'
  | 'RATE_LIMITED'
  | 'TRANSIENT_FAILURE'
  | 'API_ERROR'

const REDACTED_OWNER = '[REDACTED]'

export class InvitationHandlingError extends Error {
  readonly code: InvitationHandlingErrorCode
  readonly remediation: string

  constructor(params: {code: InvitationHandlingErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'InvitationHandlingError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

export async function handleInvitations(params: HandleInvitationsParams = {}): Promise<HandleInvitationsResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const allowlistPath = params.allowlistPath ?? DEFAULT_ALLOWLIST_PATH
  const reposPath = params.reposPath ?? DEFAULT_REPOS_PATH
  const workflowFile = params.workflowFile ?? DEFAULT_WORKFLOW_FILE
  const workflowRef = params.workflowRef ?? DEFAULT_WORKFLOW_REF
  const now = params.now ?? new Date()
  const octokit = params.octokit ?? (await createOctokitFromEnv())
  const readMetadata = params.readMetadata ?? readMetadataFromDisk
  const commitMetadataImpl = params.commitMetadata ?? commitMetadata
  const bootstrap = params.bootstrapDataBranch ?? bootstrapDataBranch

  // Ensure data branch exists before any metadata writes (idempotent — no-op if already present).
  await bootstrap({octokit, owner, repo})

  const allowlist = await loadAllowlist(readMetadata, allowlistPath)
  const approvedInviters = new Set(allowlist.approved_inviters.map(inviter => inviter.username))

  try {
    await loadRepos(readMetadata, reposPath)
  } catch (error: unknown) {
    throw normalizeMetadataError(error, 'repos')
  }

  const invitations = await pollInvitations(octokit)
  const processed: InvitationProcessResult[] = []

  for (const invitation of invitations) {
    const invitationResult = await processInvitation({
      octokit,
      owner,
      repo,
      reposPath,
      workflowFile,
      workflowRef,
      now,
      approvedInviters,
      invitation,
      commitMetadata: commitMetadataImpl,
    })

    processed.push(invitationResult)
  }

  return {processed}
}

async function processInvitation(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  reposPath: string
  workflowFile: string
  workflowRef: string
  now: Date
  approvedInviters: Set<string>
  invitation: RepositoryInvitation
  commitMetadata: (params: CommitMetadataParams) => Promise<CommitMetadataResult>
}): Promise<InvitationProcessResult> {
  const inviter = params.invitation.inviter?.login ?? null
  const repoOwner = params.invitation.repository.owner.login
  const repoName = params.invitation.repository.name
  const repoPrivacy = invitationRepositoryPrivacy(params.invitation)
  let displayTarget = invitationDisplayTarget(repoPrivacy, repoOwner, repoName)

  // Skip invitations where GitHub has nulled the inviter (deleted account). We can't allowlist-check
  // an unknown inviter, so treat it as a skip rather than failing the whole poll.
  if (inviter === null) {
    return {
      invitationId: params.invitation.id,
      inviter: null,
      owner: displayTarget.owner,
      repo: displayTarget.repo,
      status: 'skipped',
      reason: 'inviter-unknown',
    }
  }

  if (!params.approvedInviters.has(inviter)) {
    return {
      invitationId: params.invitation.id,
      inviter,
      owner: displayTarget.owner,
      repo: displayTarget.repo,
      status: 'skipped',
      reason: 'inviter-not-allowlisted',
    }
  }

  try {
    if (repoPrivacy.kind === 'private-without-node') {
      throw new Error('Private invitation is missing repository.node_id')
    }
    if (repoPrivacy.kind === 'malformed') {
      throw new Error('Invitation repository.private must be boolean when present')
    }
    if (repoPrivacy.kind === 'missing-private') {
      throw new Error('Invitation repository.private is required')
    }
    if (repoPrivacy.kind === 'missing-node') {
      throw new Error('Invitation repository.node_id is required')
    }
    if (repoPrivacy.kind !== 'public' && repoPrivacy.kind !== 'private') {
      throw new Error('Invitation repository privacy is not usable')
    }

    await acceptInvitation(params.octokit, params.invitation.id)
    const acceptedPrivacy = await acceptedInvitationRepositoryPrivacy(params.octokit, repoOwner, repoName, repoPrivacy)
    displayTarget = invitationDisplayTarget(acceptedPrivacy, repoOwner, repoName)
    await params.octokit.rest.activity.starRepoForAuthenticatedUser({owner: repoOwner, repo: repoName})
    const entryInput = {
      owner: repoOwner,
      repo: repoName,
      now: params.now,
      discovery_channel: 'collab' as const,
      ...(acceptedPrivacy.kind === 'private'
        ? {private: true, node_id: acceptedPrivacy.nodeId}
        : {private: false, node_id: acceptedPrivacy.nodeId}),
    }
    await params.commitMetadata({
      octokit: params.octokit,
      path: params.reposPath,
      message: invitationCommitMessage(displayTarget),
      mutator: current => addRepoEntry(current, entryInput),
    })
    if (acceptedPrivacy.kind !== 'private') {
      await params.octokit.rest.actions.createWorkflowDispatch({
        owner: params.owner,
        repo: params.repo,
        workflow_id: params.workflowFile,
        ref: params.workflowRef,
        inputs: {node_id: acceptedPrivacy.nodeId},
      })
    }

    return {
      invitationId: params.invitation.id,
      inviter,
      owner: displayTarget.owner,
      repo: displayTarget.repo,
      status: 'accepted',
    }
  } catch (error: unknown) {
    const normalized = normalizePerInvitationError(error)
    const message =
      displayTarget.owner === REDACTED_OWNER
        ? sanitizePrivateInvitationError(normalized.message, displayTarget.repo)
        : normalized.message

    return {
      invitationId: params.invitation.id,
      inviter,
      owner: displayTarget.owner,
      repo: displayTarget.repo,
      status: 'failed',
      errorCode: normalized.code,
      message,
    }
  }
}

async function acceptedInvitationRepositoryPrivacy(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  invitationPrivacy: PublicInvitationRepositoryPrivacy | PrivateInvitationRepositoryPrivacy,
): Promise<PublicInvitationRepositoryPrivacy | PrivateInvitationRepositoryPrivacy> {
  if (invitationPrivacy.kind === 'private') {
    return invitationPrivacy
  }

  try {
    const response = await octokit.rest.repos.get({owner, repo})
    const privateFlag = response.data.private
    const nodeId =
      typeof response.data.node_id === 'string' && response.data.node_id !== ''
        ? response.data.node_id
        : invitationPrivacy.nodeId

    if (privateFlag === false) {
      return {kind: 'public', nodeId}
    }

    return {kind: 'private', nodeId}
  } catch (error: unknown) {
    // Fail closed on transient refresh failures (rate limit, network blip) — a public
    // invitation may be temporarily classified as private until reconcile probes it. Log
    // diagnostics so the failure mode is observable; omit owner/repo to avoid training
    // future leak paths even though this branch is the public-only refresh case.
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    const kind = error instanceof Error ? error.name : 'unknown'
    process.stderr.write(
      `handle-invitation: repos.get privacy refresh failed (status=${status}, kind=${kind}); treating invitation as private.\n`,
    )
    return {kind: 'private', nodeId: invitationPrivacy.nodeId}
  }
}

interface PublicInvitationRepositoryPrivacy {
  kind: 'public'
  nodeId: string
}

interface PrivateInvitationRepositoryPrivacy {
  kind: 'private'
  nodeId: string
}

interface PrivateWithoutNodeInvitationRepositoryPrivacy {
  kind: 'private-without-node'
}

interface MissingNodeInvitationRepositoryPrivacy {
  kind: 'missing-node'
}

type InvitationRepositoryPrivacy =
  | PublicInvitationRepositoryPrivacy
  | PrivateInvitationRepositoryPrivacy
  | PrivateWithoutNodeInvitationRepositoryPrivacy
  | MissingNodeInvitationRepositoryPrivacy

interface MalformedInvitationRepositoryPrivacy {
  kind: 'malformed' | 'missing-private'
  nodeId?: string
}

function invitationRepositoryPrivacy(
  invitation: RepositoryInvitation,
): InvitationRepositoryPrivacy | MalformedInvitationRepositoryPrivacy {
  if (invitation.repository.private !== undefined && typeof invitation.repository.private !== 'boolean') {
    return {
      kind: 'malformed',
      ...(typeof invitation.repository.node_id === 'string' && invitation.repository.node_id !== ''
        ? {nodeId: invitation.repository.node_id}
        : {}),
    }
  }

  if (invitation.repository.private === undefined) {
    return {
      kind: 'missing-private',
      ...(typeof invitation.repository.node_id === 'string' && invitation.repository.node_id !== ''
        ? {nodeId: invitation.repository.node_id}
        : {}),
    }
  }

  const nodeId = invitation.repository.node_id
  if (typeof nodeId !== 'string' || nodeId === '') {
    return invitation.repository.private === true ? {kind: 'private-without-node'} : {kind: 'missing-node'}
  }

  if (invitation.repository.private !== true) {
    return {kind: 'public', nodeId}
  }

  return {kind: 'private', nodeId}
}

function invitationDisplayTarget(
  privacy: InvitationRepositoryPrivacy | MalformedInvitationRepositoryPrivacy,
  owner: string,
  repo: string,
): {owner: string; repo: string} {
  if (privacy.kind === 'private') {
    return {owner: REDACTED_OWNER, repo: privacy.nodeId}
  }
  if (privacy.kind === 'private-without-node' || privacy.kind === 'malformed' || privacy.kind === 'missing-private') {
    return {
      owner: REDACTED_OWNER,
      repo:
        (privacy.kind === 'malformed' || privacy.kind === 'missing-private') && privacy.nodeId !== undefined
          ? privacy.nodeId
          : REDACTED_OWNER,
    }
  }
  return {owner, repo}
}

function invitationCommitMessage(target: {owner: string; repo: string}): string {
  if (target.owner === REDACTED_OWNER) {
    return `chore(metadata): accept invitation ${target.repo}`
  }
  return `chore(metadata): add ${target.owner}/${target.repo} from invitation polling`
}

export function countPublicAcceptedInvitations(processed: readonly InvitationProcessResult[]): number {
  return processed.filter(result => result.status === 'accepted' && result.owner !== REDACTED_OWNER).length
}

export function formatInvitationGithubOutput(processed: readonly InvitationProcessResult[]): string {
  return `public_invitations_accepted=${countPublicAcceptedInvitations(processed)}\n`
}

function sanitizePrivateInvitationError(message: string, nodeIdOrRedacted: string): string {
  if (
    message === 'Private invitation is missing repository.node_id' ||
    message === 'Invitation repository.private must be boolean when present' ||
    message === 'Invitation repository.private is required'
  ) {
    return message
  }

  return `Private invitation handling failed for ${nodeIdOrRedacted}`
}

async function pollInvitations(octokit: OctokitClient): Promise<RepositoryInvitation[]> {
  try {
    const response = await octokit.rest.repos.listInvitationsForAuthenticatedUser()
    return response.data
  } catch (error: unknown) {
    throw normalizePollingError(error)
  }
}

async function acceptInvitation(octokit: OctokitClient, invitationId: number): Promise<void> {
  try {
    await octokit.rest.repos.acceptInvitationForAuthenticatedUser({invitation_id: invitationId})
  } catch (error: unknown) {
    if (isApiStatus(error, 404) || isApiStatus(error, 410)) {
      return
    }

    throw error
  }
}

async function loadAllowlist(readMetadata: (path: string) => Promise<unknown>, allowlistPath: string) {
  try {
    const allowlist = await readMetadata(allowlistPath)
    assertAllowlistFile(allowlist, 'allowlist')
    return allowlist
  } catch (error: unknown) {
    throw normalizeMetadataError(error, 'allowlist')
  }
}

async function loadRepos(readMetadata: (path: string) => Promise<unknown>, reposPath: string): Promise<ReposFile> {
  const repos = await readMetadata(reposPath)
  assertReposFile(repos, 'repos')
  return repos
}

async function readMetadataFromDisk(path: string): Promise<unknown> {
  const contents = await readFile(path, 'utf8')
  return parse(contents)
}

function normalizeMetadataError(error: unknown, target: 'allowlist' | 'repos'): InvitationHandlingError {
  if (error instanceof InvitationHandlingError) {
    return error
  }

  if (error instanceof SchemaValidationError) {
    return new InvitationHandlingError({
      code: target === 'allowlist' ? 'INVALID_ALLOWLIST' : 'INVALID_REPOS',
      message: `Invalid ${target} metadata: ${error.message}`,
      remediation: `Fix ${target === 'allowlist' ? DEFAULT_ALLOWLIST_PATH : DEFAULT_REPOS_PATH} so it matches the schema before rerunning invitation polling.`,
    })
  }

  const message = error instanceof Error ? error.message : `Unknown ${target} metadata error`

  return new InvitationHandlingError({
    code: target === 'allowlist' ? 'INVALID_ALLOWLIST' : 'INVALID_REPOS',
    message: `Failed to load ${target} metadata: ${message}`,
    remediation: `Ensure ${target === 'allowlist' ? DEFAULT_ALLOWLIST_PATH : DEFAULT_REPOS_PATH} exists, is readable, and matches the expected schema.`,
  })
}

function normalizePollingError(error: unknown): InvitationHandlingError {
  if (isApiStatus(error, 401) || isApiStatus(error, 403)) {
    return new InvitationHandlingError({
      code: 'CREDENTIALS_ERROR',
      message: 'GitHub rejected invitation polling credentials',
      remediation:
        'Verify FRO_BOT_POLL_PAT is present, valid, and has permission to read and accept repository invitations.',
    })
  }

  if (isApiStatus(error, 429)) {
    return new InvitationHandlingError({
      code: 'RATE_LIMITED',
      message: 'GitHub rate limited invitation polling',
      remediation: 'Retry after the GitHub API rate limit resets, or reduce polling frequency/concurrency.',
    })
  }

  if (has5xxStatus(error)) {
    return new InvitationHandlingError({
      code: 'TRANSIENT_FAILURE',
      message: 'GitHub returned a transient failure while polling invitations',
      remediation: 'Retry once. If GitHub keeps returning 5xx responses, check GitHub status before rerunning.',
    })
  }

  const message = error instanceof Error ? error.message : 'Unknown polling error'
  return new InvitationHandlingError({
    code: 'API_ERROR',
    message: `GitHub API error while polling invitations: ${message}`,
    remediation: 'Retry once. If the failure persists, inspect invitation polling logs and GitHub API health.',
  })
}

function normalizePerInvitationError(error: unknown): {
  code: InvitationHandlingErrorCode | 'API_ERROR'
  message: string
} {
  if (error instanceof InvitationHandlingError) {
    return {code: error.code, message: error.message}
  }

  if (isApiStatus(error, 401) || isApiStatus(error, 403)) {
    return {code: 'CREDENTIALS_ERROR', message: 'GitHub rejected invitation handling credentials'}
  }

  if (isApiStatus(error, 429)) {
    return {code: 'RATE_LIMITED', message: 'GitHub rate limited invitation handling'}
  }

  if (has5xxStatus(error)) {
    return {code: 'API_ERROR', message: error instanceof Error ? error.message : 'GitHub transient failure'}
  }

  return {code: 'API_ERROR', message: error instanceof Error ? error.message : 'Unknown invitation handling error'}
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN

  if (token === undefined || token === '') {
    throw new InvitationHandlingError({
      code: 'MISSING_TOKEN',
      message: 'handleInvitations requires params.octokit or GITHUB_TOKEN in the environment',
      remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
    })
  }

  const LoadedOctokit = await loadOctokitConstructor()
  return new LoadedOctokit({auth: token})
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  if (typeof Octokit !== 'function') {
    throw new InvitationHandlingError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }

  return Octokit as unknown as OctokitConstructor
}

function isApiStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status
}

function has5xxStatus(error: unknown): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status >= 500 && error.status < 600
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function main(): Promise<void> {
  const result = await handleInvitations()
  process.stdout.write(`${JSON.stringify(result)}\n`)

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput !== undefined && githubOutput !== '') {
    appendFileSync(githubOutput, formatInvitationGithubOutput(result.processed))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
