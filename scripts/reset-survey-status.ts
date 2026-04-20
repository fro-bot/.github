import process from 'node:process'

import {commitMetadata} from './commit-metadata.ts'
import {RepoEntryNotFoundError, resetSurveyResult} from './repos-metadata.ts'

/**
 * Reset `last_survey_at` and `last_survey_status` to `null` for one or more entries in
 * `metadata/repos.yaml` on the `data` branch.
 *
 * Recovery tool for misclassified survey outcomes (e.g. a wiki-commit failure that was
 * recorded as `success` under an older `SURVEY_STATUS` expression). Clearing the fields
 * forces the reconcile staleness gate to treat affected repos as never-surveyed, so they
 * re-dispatch on the next cron instead of waiting the default 30 days.
 *
 * Inputs (env vars):
 *   TARGETS           — comma-separated list of `owner/name` entries (e.g.
 *                       `marcusrbrown/.dotfiles,marcusrbrown/.github`). Whitespace around
 *                       entries and repeated commas are ignored.
 *   GITHUB_TOKEN      — App installation token with `contents:write` on the control-plane
 *                       repo (minted via `actions/create-github-app-token`). Required so
 *                       the commit on `data` is authored by `fro-bot[bot]` and passes the
 *                       reconcile integrity check.
 *   GITHUB_REPOSITORY — caller-supplied `owner/name` of the control-plane repo (GitHub
 *                       Actions sets this automatically).
 *
 * One `commitMetadata` call per target. Each call independently retries on 409 conflicts,
 * so a concurrent writer (e.g. a running survey dispatch writing `record-survey-result`)
 * does not cause data loss. Entries missing from `metadata/repos.yaml` surface as
 * `RepoEntryNotFoundError` and fail the run — operators should verify the target list
 * against the current `metadata/repos.yaml` on `data` before invoking.
 */
async function main(): Promise<void> {
  const targets = parseTargets(requiredEnv('TARGETS'))
  const [controlPlaneOwner, controlPlaneRepo] = splitControlPlane(requiredEnv('GITHUB_REPOSITORY'))

  const results: {
    owner: string
    name: string
    committed: boolean
    attempts: number
    sha?: string
  }[] = []

  for (const {owner, name} of targets) {
    const result = await commitMetadata({
      owner: controlPlaneOwner,
      repo: controlPlaneRepo,
      path: 'metadata/repos.yaml',
      message: `chore(recovery): reset survey status for ${owner}/${name}`,
      mutator: (current: unknown) => resetSurveyResult(current, {owner, repo: name}),
    })

    results.push({
      owner,
      name,
      committed: result.committed,
      attempts: result.attempts,
      ...(result.committed ? {sha: result.sha} : {}),
    })
  }

  process.stdout.write(`${JSON.stringify({targets: results.length, results}, null, 2)}\n`)
}

function parseTargets(raw: string): {owner: string; name: string}[] {
  const entries = raw
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')

  if (entries.length === 0) {
    throw new Error('TARGETS must contain at least one `owner/name` entry')
  }

  return entries.map(entry => {
    const [owner, name] = entry.split('/')
    if (owner === undefined || name === undefined || owner === '' || name === '') {
      throw new Error(`TARGETS entry must be 'owner/name', got '${entry}'`)
    }
    return {owner, name}
  })
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
    // RepoEntryNotFoundError is fatal here — recovery callers should know exactly which
    // entries they intend to reset. A typo must fail the run, not silently proceed with
    // the remaining targets.
    if (error instanceof RepoEntryNotFoundError) {
      process.stderr.write(`reset-survey-status: ${error.message}\n`)
      process.exit(1)
    }
    process.stderr.write(`reset-survey-status: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
