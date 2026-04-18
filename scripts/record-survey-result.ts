import process from 'node:process'

import {commitMetadata} from './commit-metadata.ts'
import {recordSurveyResult, RepoEntryNotFoundError} from './repos-metadata.ts'

/**
 * Write the outcome of a Survey Repo run back to `metadata/repos.yaml` on the `data` branch.
 *
 * Survey workflows call this after the agent completes and the wiki commit step finishes.
 * Writing `last_survey_at` + `last_survey_status` here is what lets reconcile's staleness
 * gate (`>30d since last survey`) distinguish fresh surveys from stale ones.
 *
 * Inputs (env vars):
 *   REPO_OWNER        — target repository owner (e.g. "marcusrbrown")
 *   REPO_NAME         — target repository name (e.g. ".dotfiles")
 *   SURVEY_STATUS     — "success" | "failure"
 *   SURVEY_AT         — ISO 8601 timestamp; defaults to "now" if absent
 *   GITHUB_TOKEN      — FRO_BOT_PAT (writes to `data`; classic PAT with repo scope)
 *   GITHUB_REPOSITORY — caller-supplied "owner/name" of the control-plane repo hosting
 *                       metadata/repos.yaml (GitHub Actions sets this automatically).
 *
 * Writes to: `metadata/repos.yaml` on the `data` branch via `commitMetadata`. Exits 0 on
 * success, non-zero with a typed error on failure. When the survey target has no entry in
 * `metadata/repos.yaml`, writes nothing and exits 0 with a warning (the entry must already
 * exist — reconcile is the canonical writer for new entries).
 */
async function main(): Promise<void> {
  const owner = requiredEnv('REPO_OWNER')
  const name = requiredEnv('REPO_NAME')
  const status = parseStatus(requiredEnv('SURVEY_STATUS'))
  const at = parseAt(process.env.SURVEY_AT)
  const [controlPlaneOwner, controlPlaneRepo] = splitControlPlane(requiredEnv('GITHUB_REPOSITORY'))

  const result = await commitMetadata({
    owner: controlPlaneOwner,
    repo: controlPlaneRepo,
    path: 'metadata/repos.yaml',
    message: `chore(reconcile): record survey ${status} for ${owner}/${name}`,
    mutator: (current: unknown) => recordSurveyResult(current, {owner, repo: name, at, status}),
  })

  if (result.committed) {
    process.stdout.write(
      `${JSON.stringify({committed: true, sha: result.sha, attempts: result.attempts, owner, name, status})}\n`,
    )
    return
  }

  // No-op commit (mutator returned the same file) — valid when status + date already match.
  process.stdout.write(`${JSON.stringify({committed: false, attempts: result.attempts, owner, name, status})}\n`)
}

function parseStatus(raw: string): 'success' | 'failure' {
  if (raw === 'success' || raw === 'failure') return raw
  throw new Error(`SURVEY_STATUS must be 'success' or 'failure', got '${raw}'`)
}

function parseAt(raw: string | undefined): Date {
  if (raw === undefined || raw === '') return new Date()
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`SURVEY_AT is not a parseable date: '${raw}'`)
  }
  return parsed
}

function splitControlPlane(raw: string): [string, string] {
  const [owner, repo] = raw.split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '') {
    throw new Error(`GITHUB_REPOSITORY must be 'owner/name', got '${raw}'`)
  }
  return [owner, repo]
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    // Surface the common "entry not found" error as a non-fatal warning — it means reconcile
    // hasn't added the repo yet, which is legitimate when a manual survey dispatch runs
    // against an un-onboarded repo. Exit 0 so the workflow doesn't mark the run as failed.
    if (error instanceof RepoEntryNotFoundError) {
      process.stderr.write(`record-survey-result: ${error.message}; skipping (non-fatal)\n`)
      process.exit(0)
    }
    process.stderr.write(`record-survey-result: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
