/**
 * Live-state resolution against the current repository with a read-only client: pull requests, issues and releases, the publicness proof that precedes any cross-repo identity, and the loop over all claims that counts resolver errors.
 */

import type {FileReader, IssueComment, IssueListItem} from './detect-extract.ts'
import {resolvePlanStatusClaim} from './detect-plan-consistency.ts'
import {resolveRolloutTrackerClaim} from './detect-rollout.ts'
import {
  CLAIM_KIND_DEFINITIONS,
  type ResolverResult,
  type StatusTruthClaim,
  type StatusTruthSnapshot,
} from './report-model.ts'

/**
 * Minimal Octokit-like client for the detect step (read-only).
 * Injected for testability; production code uses @octokit/rest Octokit.
 *
 * `paginate` mirrors the Octokit paginate API: given a REST endpoint function
 * and its params, it fetches all pages and returns the flattened data array.
 * This is the only supported pagination mechanism for issue/comment listing.
 */
export interface DetectOctokitClient {
  readonly paginate: <T>(fn: unknown, params: unknown) => Promise<T[]>
  readonly rest: {
    readonly pulls: {
      readonly get: (params: {owner: string; repo: string; pull_number: number}) => Promise<{
        data: {state: string; merged: boolean}
      }>
    }
    readonly issues: {
      readonly get: (params: {owner: string; repo: string; issue_number: number}) => Promise<{
        data: {state: string}
      }>
      readonly listForRepo: (params: {
        owner: string
        repo: string
        state: 'open' | 'closed' | 'all'
        per_page: number
      }) => Promise<{
        data: {
          number: number
          title: string
          body: string | null
          labels: {name?: string | undefined}[]
        }[]
      }>
      readonly listComments: (params: {
        owner: string
        repo: string
        issue_number: number
        per_page: number
      }) => Promise<{
        data: {id: number; body?: string | null | undefined}[]
      }>
    }
    readonly repos: {
      readonly getReleaseByTag: (params: {owner: string; repo: string; tag: string}) => Promise<{
        data: {draft: boolean; prerelease: boolean}
      }>
      /**
       * Used for cross-repo publicness proof.
       * Returns `{data: {private: boolean}}`.
       * Throws with `.status` 403 or 404 when the repo is inaccessible/private.
       */
      readonly get: (params: {owner: string; repo: string}) => Promise<{
        data: {private: boolean}
      }>
    }
  }
}

/**
 * Fetch all open issues for the current repo using Octokit pagination.
 *
 * Uses `octokit.paginate` to fetch every page, so "clean" cannot mean
 * "nothing in the first 100 results". Exported for unit-testability.
 */
export async function listCurrentRepoIssues(
  octokit: DetectOctokitClient,
  owner: string,
  repo: string,
): Promise<IssueListItem[]> {
  const raw = await octokit.paginate<{
    number: number
    title: string
    body: string | null
    labels: {name?: string | undefined}[]
  }>(octokit.rest.issues.listForRepo, {owner, repo, state: 'open', per_page: 100})
  return raw.map(issue => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map(l => ({name: l.name ?? ''})),
  }))
}

/**
 * Fetch all comments for a single issue using Octokit pagination.
 *
 * Uses `octokit.paginate` to fetch every page. Exported for unit-testability.
 */
export async function listCurrentRepoIssueComments(
  octokit: DetectOctokitClient,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueComment[]> {
  const raw = await octokit.paginate<{id: number; body?: string | null | undefined}>(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  })
  return raw.map(c => ({id: c.id, body: c.body ?? null}))
}

/**
 * Prove that a target repo is public using `repos.get`.
 *
 * Returns `true` if the repo is confirmed public.
 * Returns `false` if the repo is private (`data.private === true`).
 * Throws if the API throws 403/404 or any other error before publicness is
 * confirmed — callers must treat this as private.
 *
 * This is the ONLY gate before cross-repo identity is exposed in findings.
 */
async function proveRepoPublic(
  octokit: DetectOctokitClient,
  targetOwner: string,
  targetRepo: string,
): Promise<boolean> {
  const {data} = await octokit.rest.repos.get({owner: targetOwner, repo: targetRepo})
  return data.private === false
}

/**
 * Resolve a single claim's live state using the injected Octokit client.
 *
 * Current-repo scoped: only resolves claims whose sourceRef is a bare `#N` or `@tag`
 * (no `owner/repo` prefix). Cross-repo or unsupported refs return `unavailable`.
 *
 * PR state: 'open' | 'closed' | 'merged'
 * Issue state: 'open' | 'closed'
 * Release state: 'published' | 'draft'
 * Plan-status: resolved via file-parse using the injected fileReader
 * Rollout-tracker: compound — returns unavailable (Phase 1 scope cut)
 */
export async function resolveClaimLiveState(params: {
  claim: StatusTruthClaim
  octokit: DetectOctokitClient
  owner: string
  repo: string
  /** Optional file reader for plan-status file-parse resolution. */
  fileReader?: FileReader
  /** Optional rollout snapshot for rollout-tracker-status compound resolution. */
  snapshot?: StatusTruthSnapshot | null
}): Promise<ResolverResult> {
  const {claim, octokit, owner, repo, fileReader, snapshot} = params

  // ---------------------------------------------------------------------------
  // Cross-repo resolution: publicness proof required before any identity exposure
  // ---------------------------------------------------------------------------
  if (claim.targetOwner !== undefined && claim.targetRepo !== undefined) {
    const targetOwner = claim.targetOwner
    const targetRepo = claim.targetRepo

    // Step 1: Prove publicness. Any failure before proof → private.
    let isPublic: boolean
    try {
      isPublic = await proveRepoPublic(octokit, targetOwner, targetRepo)
    } catch {
      // 403, 404, or any other error before proof → treat as private
      return {status: 'private'}
    }

    if (!isPublic) {
      return {status: 'private'}
    }

    // Step 2: Publicness proven. Resolve against target repo.
    // API failure AFTER proof → unavailable (identity already proven public).
    if (claim.kind === 'pr-state') {
      const match = /^[\w.-]+\/[\w.-]+#(\d+)$/u.exec(claim.sourceRef)
      if (match === null || match[1] === undefined) return {status: 'unavailable'}
      const prNumber = Number.parseInt(match[1], 10)

      // Ambiguous open/closed: try PR first, fall back to issue if PR lookup fails
      if (claim.targetNumberKind === 'ambiguous') {
        try {
          const {data} = await octokit.rest.pulls.get({owner: targetOwner, repo: targetRepo, pull_number: prNumber})
          if (data.merged) return {status: 'resolved', state: 'merged', resolvedKind: 'pr-state'}
          return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed', resolvedKind: 'pr-state'}
        } catch {
          // PR lookup failed — try issue fallback
        }
        try {
          const {data} = await octokit.rest.issues.get({
            owner: targetOwner,
            repo: targetRepo,
            issue_number: prNumber,
          })
          return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed', resolvedKind: 'issue-state'}
        } catch {
          return {status: 'unavailable'}
        }
      }

      // Explicit PR (merged, or targetNumberKind === 'pr')
      try {
        const {data} = await octokit.rest.pulls.get({owner: targetOwner, repo: targetRepo, pull_number: prNumber})
        if (data.merged) return {status: 'resolved', state: 'merged'}
        return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
      } catch {
        return {status: 'unavailable'}
      }
    }

    if (claim.kind === 'issue-state') {
      const match = /^[\w.-]+\/[\w.-]+#(\d+)$/u.exec(claim.sourceRef)
      if (match === null || match[1] === undefined) return {status: 'unavailable'}
      const issueNumber = Number.parseInt(match[1], 10)
      try {
        const {data} = await octokit.rest.issues.get({owner: targetOwner, repo: targetRepo, issue_number: issueNumber})
        return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
      } catch {
        return {status: 'unavailable'}
      }
    }

    if (claim.kind === 'release-tag-state') {
      const match = /^[\w.-]+\/[\w.-]+@(.+)$/u.exec(claim.sourceRef)
      if (match === null || match[1] === undefined) return {status: 'unavailable'}
      const tag = match[1]
      try {
        const {data} = await octokit.rest.repos.getReleaseByTag({owner: targetOwner, repo: targetRepo, tag})
        return {status: 'resolved', state: data.draft ? 'draft' : 'published'}
      } catch {
        return {status: 'unavailable'}
      }
    }

    // Unsupported cross-repo claim kind
    return {status: 'unavailable'}
  }

  if (claim.kind === 'plan-status') {
    // plan-status uses the file-parse resolver: reads the target plan file's
    // frontmatter and returns the live status value.
    // sourceRef is the repo-relative plan path (e.g., docs/plans/foo.md).
    if (fileReader === undefined) {
      // No file reader injected — unavailable (e.g., called from API-only path)
      return {status: 'unavailable'}
    }
    return resolvePlanStatusClaim({
      claimedPath: claim.sourceRef,
      fileReader,
    })
  }

  if (claim.kind === 'rollout-tracker-status') {
    // Compound resolver: use snapshot when provided; otherwise unavailable.
    // snapshot === undefined means no snapshot was passed (Phase 1 behavior preserved).
    // snapshot === null means snapshot was explicitly passed as unavailable.
    if (snapshot === undefined) {
      return {status: 'unavailable'}
    }
    return resolveRolloutTrackerClaim({claim, snapshot})
  }

  if (claim.kind === 'pr-state') {
    // sourceRef must be bare `#N` for current-repo
    const match = /^#(\d+)$/u.exec(claim.sourceRef)
    if (match === null || match[1] === undefined) {
      // Cross-repo or malformed ref — unavailable
      return {status: 'unavailable'}
    }
    const prNumber = Number.parseInt(match[1], 10)
    try {
      const {data} = await octokit.rest.pulls.get({owner, repo, pull_number: prNumber})
      if (data.merged) return {status: 'resolved', state: 'merged'}
      return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
    } catch {
      return {status: 'unavailable'}
    }
  }

  if (claim.kind === 'issue-state') {
    const match = /^#(\d+)$/u.exec(claim.sourceRef)
    if (match === null || match[1] === undefined) {
      return {status: 'unavailable'}
    }
    const issueNumber = Number.parseInt(match[1], 10)
    try {
      const {data} = await octokit.rest.issues.get({owner, repo, issue_number: issueNumber})
      return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
    } catch {
      return {status: 'unavailable'}
    }
  }

  if (claim.kind === 'release-tag-state') {
    const match = /^@(.+)$/u.exec(claim.sourceRef)
    if (match === null || match[1] === undefined) {
      return {status: 'unavailable'}
    }
    const tag = match[1]
    try {
      const {data} = await octokit.rest.repos.getReleaseByTag({owner, repo, tag})
      return {status: 'resolved', state: data.draft ? 'draft' : 'published'}
    } catch {
      return {status: 'unavailable'}
    }
  }

  return {status: 'unavailable'}
}

/**
 * Resolve file-parse claims (plan-status) without an Octokit client.
 *
 * Only resolves claims whose resolver type is `file-parse`. API-backed and
 * compound claims are skipped — they remain absent from the returned map,
 * which `detectStatusTruthClaims` treats as unresolved.
 *
 * This is called in `runDetect` before the token-gated API resolution block
 * so that plan-status findings are produced even when no GITHUB_TOKEN is set.
 *
 * @param params - Resolution parameters.
 * @param params.claims - All extracted claims (mixed kinds).
 * @param params.fileReader - File reader for reading plan frontmatter.
 * @returns Resolver results map keyed by `kind:sourceRef` for file-parse claims only.
 */
export async function resolveFileParseClaims(params: {
  claims: readonly StatusTruthClaim[]
  fileReader: FileReader
}): Promise<Record<string, ResolverResult>> {
  const {claims, fileReader} = params
  const resolverResults: Record<string, ResolverResult> = {}
  const seen = new Set<string>()

  for (const claim of claims) {
    const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === claim.kind)
    if (def?.resolverType !== 'file-parse') continue

    const key = `${claim.kind}:${claim.sourceRef}`
    if (seen.has(key)) continue
    seen.add(key)

    if (claim.kind === 'plan-status') {
      resolverResults[key] = await resolvePlanStatusClaim({
        claimedPath: claim.sourceRef,
        fileReader,
      })
    }
  }

  return resolverResults
}

/**
 * Resolve all claims against live state using the injected Octokit client.
 *
 * Returns a resolver results map keyed by `kind:sourceRef`.
 * Resolution failures for individual claims are counted but do not abort.
 *
 * @param params - Resolution parameters.
 * @param params.claims - Claims to resolve.
 * @param params.octokit - Octokit client for API-backed resolution.
 * @param params.owner - Repository owner.
 * @param params.repo - Repository name.
 * @param params.fileReader - Optional file reader for plan-status file-parse resolution.
 *   Required when plan-status claims are present in the claims list.
 * @param params.snapshot - Optional rollout snapshot for rollout-tracker-status compound resolution.
 *   `undefined` (absent) → rollout-tracker claims stay unavailable (Phase 1 behavior).
 *   `null` → snapshot was attempted but unavailable; rollout-tracker claims stay unavailable.
 *   `StatusTruthSnapshot` → snapshot available; rollout-tracker claims resolve against it.
 */
export async function resolveAllClaims(params: {
  claims: readonly StatusTruthClaim[]
  octokit: DetectOctokitClient
  owner: string
  repo: string
  fileReader?: FileReader
  snapshot?: StatusTruthSnapshot | null
}): Promise<{resolverResults: Record<string, ResolverResult>; resolveErrors: number}> {
  const {claims, octokit, owner, repo, fileReader, snapshot} = params
  const resolverResults: Record<string, ResolverResult> = {}
  let resolveErrors = 0

  // Deduplicate by kind:sourceRef to avoid redundant API calls
  const seen = new Set<string>()

  for (const claim of claims) {
    const key = `${claim.kind}:${claim.sourceRef}`
    if (seen.has(key)) continue
    seen.add(key)

    try {
      resolverResults[key] = await resolveClaimLiveState({claim, octokit, owner, repo, fileReader, snapshot})
    } catch {
      resolveErrors++
      resolverResults[key] = {status: 'unavailable'}
    }
  }

  return {resolverResults, resolveErrors}
}
