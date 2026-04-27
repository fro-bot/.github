import type {Octokit} from '@octokit/rest'
import fs from 'node:fs'
import process from 'node:process'

export type OctokitClient = Octokit

/** The permanent label applied to every journal issue. */
const JOURNAL_LABEL = 'journal'
/** Applied only to today's open journal issue; removed when a new day begins. */
const JOURNAL_ACTIVE_LABEL = 'journal-active'
const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'

export interface JournalEntryParams {
  /** Event type identifier (e.g. `invitation_accepted`). */
  eventType: string
  /** In-character character voice text for the comment body. */
  text: string
  /** Structured metadata emitted inside a collapsed `<details>` block. */
  metadata: Record<string, unknown>
  /** Repo context for the event (e.g. `owner/repo`). */
  repo?: string
  /** GitHub Actions run URL for traceability. */
  runUrl?: string
  /** Authenticated Octokit client. Defaults to env-var-based auth. */
  octokit?: OctokitClient
  /** Override the owner for testing. Defaults to `fro-bot`. */
  owner?: string
  /** Override the repo name for testing. Defaults to `.github`. */
  repoName?: string
  /** Override the current date for testing. Defaults to `new Date()`. */
  now?: Date
}

export interface JournalEntryResult {
  issueNumber: number
  commentId: number
  /** Whether a new journal issue was created for today. */
  created: boolean
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildIssueTitle(dateStr: string): string {
  return `[${dateStr}] Fro Bot operational log`
}

function buildCommentBody(text: string, metadata: Record<string, unknown>): string {
  const metadataJson = JSON.stringify(metadata, null, 2)
  return `${text}

<details>
<summary>Structured metadata</summary>

\`\`\`json
${metadataJson}
\`\`\`

</details>`
}

async function loadOctokit(token: string): Promise<OctokitClient> {
  const {Octokit} = await import('@octokit/rest')
  return new Octokit({auth: token})
}

/**
 * Append a journal entry to today's operational log issue.
 *
 * Creates the daily issue if it does not exist, and relabels any
 * previous-day active journal issue by removing the `journal-active` label.
 */
export async function appendJournalEntry(params: JournalEntryParams): Promise<JournalEntryResult> {
  const token = process.env.FRO_BOT_PAT ?? process.env.GITHUB_TOKEN ?? ''
  const octokit = params.octokit ?? (await loadOctokit(token))
  const owner = params.owner ?? DEFAULT_OWNER
  const repoName = params.repoName ?? DEFAULT_REPO
  const today = params.now ?? new Date()
  const todayStr = formatDate(today)
  const todayTitle = buildIssueTitle(todayStr)

  // Find any currently active journal issues.
  const search = await octokit.rest.search.issuesAndPullRequests({
    q: `repo:${owner}/${repoName} is:issue is:open label:${JOURNAL_ACTIVE_LABEL}`,
    sort: 'created',
    order: 'desc',
    per_page: 10,
  })

  let todayIssueNumber: number | undefined
  const staleActiveIssues: number[] = []

  for (const item of search.data.items) {
    if (item.title === todayTitle) {
      todayIssueNumber ??= item.number
    } else {
      staleActiveIssues.push(item.number)
    }
  }

  // Retire previous-day active issues: remove the active label so they remain
  // open but no longer surface as the current day's log.
  for (const issueNumber of staleActiveIssues) {
    await octokit.rest.issues.removeLabel({
      owner,
      repo: repoName,
      issue_number: issueNumber,
      name: JOURNAL_ACTIVE_LABEL,
    })
  }

  let created = false
  if (todayIssueNumber === undefined) {
    const newIssue = await octokit.rest.issues.create({
      owner,
      repo: repoName,
      title: todayTitle,
      body: `Fro Bot operational log for ${todayStr}.`,
      labels: [JOURNAL_LABEL, JOURNAL_ACTIVE_LABEL],
    })
    todayIssueNumber = newIssue.data.number
    created = true
  }

  const eventMetadata: Record<string, unknown> = {
    event: params.eventType,
    timestamp: today.toISOString(),
    ...params.metadata,
  }
  if (params.repo !== undefined) eventMetadata.repo = params.repo
  if (params.runUrl !== undefined) eventMetadata.run_url = params.runUrl

  const commentBody = buildCommentBody(params.text, eventMetadata)
  const comment = await octokit.rest.issues.createComment({
    owner,
    repo: repoName,
    issue_number: todayIssueNumber,
    body: commentBody,
  })

  return {
    issueNumber: todayIssueNumber,
    commentId: comment.data.id,
    created,
  }
}

async function main(): Promise<void> {
  // Minimal arg parsing: --event, --text, --metadata, --repo, --run-url
  const args = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx === -1 ? undefined : args[idx + 1]
  }

  const eventType = get('--event')
  const text = get('--text')
  const metadataRaw = get('--metadata') ?? '{}'
  const repo = get('--repo')
  const runUrl = get('--run-url')

  if (eventType === undefined || eventType === '' || text === undefined || text === '') {
    process.stderr.write(
      'Usage: journal-entry.ts --event <type> --text <text> [--metadata <json>] [--repo <owner/repo>] [--run-url <url>]\n',
    )
    process.exit(1)
  }

  let metadata: Record<string, unknown> = {}
  try {
    metadata = JSON.parse(metadataRaw) as Record<string, unknown>
  } catch {
    process.stderr.write(`Invalid --metadata JSON: ${metadataRaw}\n`)
    process.exit(1)
  }

  const result = await appendJournalEntry({eventType, text, metadata, repo, runUrl})
  process.stdout.write(`${JSON.stringify(result)}\n`)

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput !== undefined && githubOutput !== '') {
    fs.appendFileSync(githubOutput, `issue_number=${result.issueNumber}\n`)
    fs.appendFileSync(githubOutput, `comment_id=${result.commentId}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
