/**
 * The proposal executor and its fetches. It confirms the required labels (fail closed when any is missing), reads the existing proposal issues with exhaustive pagination, and applies the planned actions to GitHub, or only counts them in a dry run. One failed action does not stop the rest.
 */

import type {ExistingProposalIssue} from './proposal-outcomes.ts'
import type {ProposalAction} from './proposal-plan.ts'
import {isApiStatus} from '@fro-bot/core/guards'
import {PROPOSAL_LABEL, REQUIRED_LABELS, type StatusTruthLabelDescriptor} from './proposal-labels.ts'

/**
 * Shape of a single issue returned by listForRepo.
 * Minimal fields needed for proposal lifecycle management.
 */
export interface IssueListItem {
  readonly number: number
  readonly state: string
  readonly title: string
  readonly body: string | null | undefined
  readonly labels: readonly (string | {readonly name?: string | null | undefined})[]
  /** ISO 8601 timestamp when the issue was closed, if available from the API. */
  readonly closed_at?: string | null
}

/**
 * Minimal Octokit-like client interface for proposal issue mutations.
 * Injected for testability; production code uses @octokit/rest Octokit.
 * Uses function property style (not method shorthand) per lint rules.
 */
export interface StatusTruthOctokitClient {
  readonly rest: {
    readonly issues: {
      readonly getLabel: (params: {owner: string; repo: string; name: string}) => Promise<{data: {name: string}}>
      readonly createLabel: (params: {
        owner: string
        repo: string
        name: string
        color: string
        description: string
      }) => Promise<{data: {name: string}}>
      readonly create: (params: {
        owner: string
        repo: string
        title: string
        body: string
        labels: string[]
      }) => Promise<{data: {number: number}}>
      readonly createComment: (params: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => Promise<{data: {id: number}}>
      readonly update: (params: {
        owner: string
        repo: string
        issue_number: number
        state?: 'open' | 'closed'
        labels?: string[]
      }) => Promise<{data: {number: number}}>
      readonly removeLabel: (params: {
        owner: string
        repo: string
        issue_number: number
        name: string
      }) => Promise<{data: unknown[]}>
      readonly addLabels: (params: {
        owner: string
        repo: string
        issue_number: number
        labels: string[]
      }) => Promise<{data: unknown[]}>
      readonly listForRepo: (params: {
        owner: string
        repo: string
        labels: string
        state: 'open' | 'closed' | 'all'
        per_page: number
        page: number
      }) => Promise<{data: IssueListItem[]}>
    }
  }
}

/**
 * Fetch all pages of issues from a single `listForRepo` call until an empty page is returned.
 *
 * Any API error is propagated to the caller (fail-closed).
 */
async function paginateAll(
  listFn: (page: number) => Promise<{data: IssueListItem[]}>,
  perPage = 100,
): Promise<IssueListItem[]> {
  const all: IssueListItem[] = []
  let page = 1
  for (;;) {
    const response = await listFn(page)
    all.push(...response.data)
    if (response.data.length < perPage) break
    page++
  }
  return all
}

/**
 * Fetch existing status-truth proposal issues from GitHub.
 *
 * Fetches all open and all closed issues labeled with PROPOSAL_LABEL using
 * exhaustive pagination. Filters to only issues that have the proposal label.
 * Returns them as ExistingProposalIssue[] for the lifecycle planner.
 *
 * Fail-closed in live mode: any API error is re-thrown so the caller can
 * abort before planning/executing mutations. In dry-run the caller may
 * choose to swallow the error and fall back to an empty list.
 *
 * Exported for testability.
 */
export async function fetchExistingProposalIssues(params: {
  octokit: StatusTruthOctokitClient
  owner: string
  repo: string
}): Promise<ExistingProposalIssue[]> {
  const {octokit, owner, repo} = params
  const issues: ExistingProposalIssue[] = []

  // Fetch all open issues with the proposal label.
  // Any error is propagated to the caller (fail-closed in live mode).
  const perPage = 100
  const openItems = await paginateAll(
    async page =>
      octokit.rest.issues.listForRepo({
        owner,
        repo,
        labels: PROPOSAL_LABEL,
        state: 'open',
        per_page: perPage,
        page,
      }),
    perPage,
  )
  for (const issue of openItems) {
    const labelNames = issue.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean)
    if (!labelNames.includes(PROPOSAL_LABEL)) continue
    issues.push({
      number: issue.number,
      state: 'open',
      labels: labelNames,
      title: issue.title,
      body: issue.body,
    })
  }

  // Fetch all closed issues with the proposal label.
  // Any error is propagated to the caller (fail-closed in live mode).
  const closedItems = await paginateAll(
    async page =>
      octokit.rest.issues.listForRepo({
        owner,
        repo,
        labels: PROPOSAL_LABEL,
        state: 'closed',
        per_page: perPage,
        page,
      }),
    perPage,
  )
  for (const issue of closedItems) {
    const labelNames = issue.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean)
    if (!labelNames.includes(PROPOSAL_LABEL)) continue
    issues.push({
      number: issue.number,
      state: 'closed',
      labels: labelNames,
      title: issue.title,
      body: issue.body,
      closedAt: issue.closed_at ?? null,
    })
  }

  return issues
}

/** Input to the I/O executor. */
export interface ExecuteStatusTruthProposalActionsInput {
  /** Injected Octokit-like client for GitHub API calls. */
  readonly octokit: StatusTruthOctokitClient
  readonly owner: string
  readonly repo: string
  /** Planned actions from the pure lifecycle planner. */
  readonly actions: readonly ProposalAction[]
  /**
   * When true: count actions but perform zero GitHub mutations.
   * Summary clearly marks dry-run status.
   */
  readonly dryRun: boolean
  /**
   * Fingerprints already created in this run (same-run dedup guard).
   * Prevents duplicate proposals when GitHub issue listing lags same-run writes.
   */
  readonly sameRunCreatedFingerprints: ReadonlySet<string>
}

/** Counts returned by the executor. */
export interface ExecuteStatusTruthProposalActionsCounts {
  readonly opened: number
  readonly updated: number
  readonly reopened: number
  readonly closed: number
  readonly suppressed: number
  readonly failed: number
  readonly sameRunDeduplicated: number
}

/** Result of the I/O executor. */
export interface ExecuteStatusTruthProposalActionsResult {
  readonly dryRun: boolean
  /** True when required labels could not be confirmed; no proposals were opened. */
  readonly labelGateFailed: boolean
  readonly counts: ExecuteStatusTruthProposalActionsCounts
}

/**
 * Ensure all required labels exist in the repo.
 *
 * For each label:
 * - If getLabel succeeds: confirmed.
 * - If 404: attempt createLabel.
 *   - createLabel succeeds or 422 (race): confirmed.
 *   - createLabel other failure: excluded.
 * - getLabel non-404 failure: excluded.
 *
 * Returns a Set<string> of confirmed label names.
 * Caller must check that all required labels are in the set before proceeding.
 */
async function ensureStatusTruthLabels(
  octokit: StatusTruthOctokitClient,
  owner: string,
  repo: string,
  labels: readonly StatusTruthLabelDescriptor[],
): Promise<Set<string>> {
  const confirmed = new Set<string>()

  for (const {name, color, description} of labels) {
    try {
      await octokit.rest.issues.getLabel({owner, repo, name})
      confirmed.add(name)
      continue
    } catch (getError: unknown) {
      if (!isApiStatus(getError, 404)) {
        // Non-404 failure: cannot confirm this label
        continue
      }
    }

    // Label not found (404) — create it
    try {
      await octokit.rest.issues.createLabel({owner, repo, name, color, description})
      confirmed.add(name)
    } catch (createError: unknown) {
      if (isApiStatus(createError, 422)) {
        // Race with another writer — label may now exist. Confirm with getLabel
        // before adding to confirmed set. A 422 alone is not sufficient proof
        // because it could also indicate a validation error on the label name.
        try {
          await octokit.rest.issues.getLabel({owner, repo, name})
          confirmed.add(name)
        } catch {
          // getLabel failed after 422 — cannot confirm label exists
        }
      }
      // Other failure: label not confirmed
    }
  }

  return confirmed
}

/**
 * Execute planned status-truth proposal lifecycle actions against GitHub.
 *
 * Processing order:
 * 1. Label preflight: confirm all REQUIRED_LABELS exist (create if missing).
 *    Fail closed if the primary proposal label cannot be confirmed.
 * 2. For each action:
 *    - dry-run: count only, no mutations.
 *    - open: same-run dedup check, then issues.create.
 *    - update-comment: issues.createComment.
 *    - reopen: issues.update(state=open) + remove resolving labels + add recurring.
 *    - close: issues.createComment + issues.update(state=closed) + add resolved label.
 *    - suppress: count only, no API call.
 * 3. One action failure does not abort remaining actions.
 * 4. stdout/stderr carry counts only; no raw claim text, fingerprints, or tokens.
 */
export async function executeStatusTruthProposalActions(
  input: ExecuteStatusTruthProposalActionsInput,
): Promise<ExecuteStatusTruthProposalActionsResult> {
  const {octokit, owner, repo, actions, dryRun, sameRunCreatedFingerprints} = input

  // In dry-run mode: count actions but perform zero mutations.
  // Label preflight is skipped in dry-run (no API calls at all).
  if (dryRun) {
    let opened = 0
    let updated = 0
    let reopened = 0
    let closed = 0
    let suppressed = 0
    let sameRunDeduplicated = 0

    for (const action of actions) {
      if (action.type === 'open') {
        if (sameRunCreatedFingerprints.has(action.fingerprint)) {
          sameRunDeduplicated++
        } else {
          opened++
        }
      } else if (action.type === 'update-comment') {
        updated++
      } else if (action.type === 'reopen') {
        reopened++
      } else if (action.type === 'close') {
        closed++
      } else if (action.type === 'suppress') {
        suppressed++
      }
    }

    return {
      dryRun: true,
      labelGateFailed: false,
      counts: {opened, updated, reopened, closed, suppressed, failed: 0, sameRunDeduplicated},
    }
  }

  // Label preflight: confirm all required labels exist.
  const confirmedLabels = await ensureStatusTruthLabels(octokit, owner, repo, REQUIRED_LABELS)

  // Fail closed if ANY required label cannot be confirmed.
  // Without all required labels, proposals would be opened without outcome labels,
  // breaking the lifecycle state machine (terminal suppression, reopen, close-on-clear).
  const missingRequired = REQUIRED_LABELS.filter(l => !confirmedLabels.has(l.name))
  if (missingRequired.length > 0) {
    return {
      dryRun: false,
      labelGateFailed: true,
      counts: {opened: 0, updated: 0, reopened: 0, closed: 0, suppressed: 0, failed: 0, sameRunDeduplicated: 0},
    }
  }

  // Same-run in-memory set (guards eventual-consistency race)
  const createdThisRun = new Set<string>(sameRunCreatedFingerprints)

  let opened = 0
  let updated = 0
  let reopened = 0
  let closed = 0
  let suppressed = 0
  let failed = 0
  let sameRunDeduplicated = 0

  for (const action of actions) {
    if (action.type === 'open') {
      // Same-run dedup: skip if already created this run
      if (createdThisRun.has(action.fingerprint)) {
        sameRunDeduplicated++
        continue
      }

      try {
        await octokit.rest.issues.create({
          owner,
          repo,
          title: action.title,
          body: action.body,
          labels: action.labels.filter(l => confirmedLabels.has(l)),
        })
        createdThisRun.add(action.fingerprint)
        opened++
      } catch {
        failed++
      }
    } else if (action.type === 'update-comment') {
      try {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: action.issueNumber,
          body: action.comment,
        })
        updated++
      } catch {
        failed++
      }
    } else if (action.type === 'reopen') {
      try {
        // Remove resolving labels first
        for (const label of action.removeLabels) {
          try {
            await octokit.rest.issues.removeLabel({owner, repo, issue_number: action.issueNumber, name: label})
          } catch {
            // Label may not exist; continue
          }
        }
        // Add recurring label
        if (action.addLabels.length > 0) {
          try {
            await octokit.rest.issues.addLabels({
              owner,
              repo,
              issue_number: action.issueNumber,
              labels: action.addLabels.filter(l => confirmedLabels.has(l)),
            })
          } catch {
            // Non-fatal: label add failure does not block reopen
          }
        }
        // Reopen the issue
        await octokit.rest.issues.update({owner, repo, issue_number: action.issueNumber, state: 'open'})
        // Add recurrence comment
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: action.issueNumber,
          body: action.comment,
        })
        reopened++
      } catch {
        failed++
      }
    } else if (action.type === 'close') {
      try {
        // Add resolved label and close
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: action.issueNumber,
          labels: action.labels.filter(l => confirmedLabels.has(l)),
        })
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: action.issueNumber,
          body: action.comment,
        })
        await octokit.rest.issues.update({owner, repo, issue_number: action.issueNumber, state: 'closed'})
        closed++
      } catch {
        failed++
      }
    } else if (action.type === 'suppress') {
      // Suppress: count only, no API call
      suppressed++
    }
  }

  return {
    dryRun: false,
    labelGateFailed: false,
    counts: {opened, updated, reopened, closed, suppressed, failed, sameRunDeduplicated},
  }
}
