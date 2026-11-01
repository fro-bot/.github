/**
 * The `data` branch integrity check: the tip commit must be authored by Fro Bot and the `data` rules must be
 * effective. A failure files an alert issue and the handler throws `DATA_BRANCH_TAMPER`. Nothing here is
 * exported by name outside the handler, so the tests drive it through `handleReconcile`.
 */

import {isApiStatus, isRecord} from '@fro-bot/core/guards'
import {callIssuesCreate} from './reconcile-effects.ts'
import {INTEGRITY_ALERT_LABEL} from './reconcile-labels.ts'
import {toApiError, type OctokitClient, type ReconcileLogger} from './reconcile-model.ts'

// `data` is written only by the Fro Bot App, so the tip commit must be authored by `fro-bot[bot]`.
const EXPECTED_AUTHORS = new Set<string>(['fro-bot[bot]'])

// Rule types that must be effective on `data`: the App-only write lock (`update`, `non_fast_forward`,
// `creation`) and the delete block (`deletion`). Bypass actors are not checked; the writer token cannot read them.
const REQUIRED_DATA_BRANCH_RULES = ['update', 'non_fast_forward', 'creation', 'deletion'] as const

export const INTEGRITY_REMEDIATION =
  'Only the Fro Bot App (`fro-bot[bot]`) may write to `data`, and the `data` rules (update, non_fast_forward, creation, deletion) must be active. Check the repository rulesets and who has contents:write on this repo.'

interface IntegrityCheckOkResult {
  ok: true
  status: 'ok' | 'skipped-no-data-branch'
}

type IntegrityCheckFailResult =
  | {ok: false; kind: 'author'; authorLogin: string | null; sha: string}
  | {ok: false; kind: 'rules-missing'; missingRules: string[]; sha: string}
  | {ok: false; kind: 'rules-unreadable'; error: string; sha: string}

export function describeIntegrityFailure(failure: IntegrityCheckFailResult): string {
  switch (failure.kind) {
    case 'author':
      return `Unexpected author on data branch tip commit: ${failure.authorLogin ?? 'unknown'} (sha: ${failure.sha})`
    case 'rules-missing':
      return `Required rules missing on data branch: ${failure.missingRules.join(', ')} (tip sha: ${failure.sha})`
    case 'rules-unreadable':
      return `Could not read the effective rules for the data branch: ${failure.error} (tip sha: ${failure.sha})`
  }
}

export async function verifyDataBranchIntegrity(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
}): Promise<IntegrityCheckOkResult | IntegrityCheckFailResult> {
  try {
    const response = await params.writerOctokit.rest.repos.getBranch({
      owner: params.owner,
      repo: params.repo,
      branch: 'data',
    })
    const commit = response.data.commit as {sha: string; author?: {login?: string} | null}
    const authorLogin = typeof commit.author?.login === 'string' ? commit.author.login : null
    if (authorLogin === null || !EXPECTED_AUTHORS.has(authorLogin)) {
      return {ok: false, kind: 'author', authorLogin, sha: commit.sha}
    }
    return await verifyDataBranchRules({...params, sha: commit.sha})
  } catch (error: unknown) {
    if (isApiStatus(error, 404)) {
      return {ok: true, status: 'skipped-no-data-branch'}
    }
    throw toApiError(error, 'verifying data branch integrity')
  }
}

/**
 * Reads the effective rules for `data` and requires every type in REQUIRED_DATA_BRANCH_RULES.
 * Fails closed: an unreadable answer is a failure, never "verified". Errors are caught here so a
 * 404 from the rules endpoint cannot be mistaken for the missing-branch skip in the caller.
 */
async function verifyDataBranchRules(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
  sha: string
}): Promise<IntegrityCheckOkResult | IntegrityCheckFailResult> {
  let rules: {type: string}[]
  try {
    const response = await params.writerOctokit.rest.repos.getBranchRules({
      owner: params.owner,
      repo: params.repo,
      branch: 'data',
    })
    rules = response.data
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? `status ${error.status}` : null
    const detail = error instanceof Error ? error.message : 'unknown error'
    return {
      ok: false,
      kind: 'rules-unreadable',
      error: status === null ? detail : `${detail} (${status})`,
      sha: params.sha,
    }
  }
  const present = new Set(rules.map(rule => rule.type))
  const missingRules = REQUIRED_DATA_BRANCH_RULES.filter(type => !present.has(type))
  if (missingRules.length > 0) {
    return {ok: false, kind: 'rules-missing', missingRules, sha: params.sha}
  }
  return {ok: true, status: 'ok'}
}

function integrityAlertContent(failure: IntegrityCheckFailResult): {title: string; lines: string[]} {
  switch (failure.kind) {
    case 'author':
      return {
        title: 'Reconcile integrity alert: unexpected author on data branch',
        lines: [
          'Unexpected author on `data` branch tip commit. Reconcile refuses to commit on top of tampered-looking state.',
          '',
          `- Tip SHA: \`${failure.sha}\``,
          `- Author login: \`${failure.authorLogin ?? 'unknown'}\``,
          '- Expected: `fro-bot[bot]` (the Fro Bot App is the only writer of `data`).',
          '',
          'Next steps:',
          '- Investigate who else has `contents:write` on this repository.',
          '- If the commit is a legitimate one-off operator action, rewrite the branch tip as `fro-bot[bot]` before rerunning.',
        ],
      }
    case 'rules-missing':
      return {
        title: 'Reconcile integrity alert: data branch rules missing',
        lines: [
          'Required rules are not in effect on the `data` branch. Reconcile refuses to commit while the App-only write lock is unverified.',
          '',
          `- Tip SHA: \`${failure.sha}\``,
          `- Missing rule types: ${failure.missingRules.map(rule => `\`${rule}\``).join(', ')}`,
          `- Required: ${REQUIRED_DATA_BRANCH_RULES.map(rule => `\`${rule}\``).join(', ')}`,
          '',
          'Next steps:',
          '- Check the repository rulesets that target `data` (`GET /repos/{owner}/{repo}/rules/branches/data`).',
          '- Restore the missing rules, then rerun reconcile.',
        ],
      }
    case 'rules-unreadable':
      return {
        title: 'Reconcile integrity alert: data branch rules unreadable',
        lines: [
          'The effective rules for the `data` branch could not be read. Reconcile fails closed and refuses to commit.',
          '',
          `- Tip SHA: \`${failure.sha}\``,
          `- Error: ${failure.error}`,
          '',
          'Next steps:',
          '- Check the rules endpoint (`GET /repos/{owner}/{repo}/rules/branches/data`) and the writer token, then rerun reconcile.',
        ],
      }
  }
}

export async function fileIntegrityAlert(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
  failure: IntegrityCheckFailResult
  logger: ReconcileLogger
}): Promise<void> {
  const {title, lines} = integrityAlertContent(params.failure)
  try {
    await callIssuesCreate(params.writerOctokit, {
      owner: params.owner,
      repo: params.repo,
      title,
      body: lines.join('\n'),
      labels: [INTEGRITY_ALERT_LABEL],
    })
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    params.logger.warn(`reconcile: failed to file integrity alert issue (status=${status}).`)
  }
}
