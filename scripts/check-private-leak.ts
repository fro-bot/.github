import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import process from 'node:process'

import {parse as parseYaml} from 'yaml'
import {assertReposFile} from './schemas.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardResult = {readonly ok: true} | {readonly ok: false; readonly matchedFiles: readonly string[]}

export interface OverrideOptions {
  readonly titlePrefixed: boolean
  readonly isOperator: boolean
}

// ---------------------------------------------------------------------------
// Operator override
// ---------------------------------------------------------------------------

/**
 * The GitHub login of the operator permitted to use the [allow-private-leak] title prefix.
 * Kept as a literal constant so it never leaks via computed interpolation.
 */
const OPERATOR_LOGIN = 'marcusrbrown'

// ---------------------------------------------------------------------------
// Pure decision function
// ---------------------------------------------------------------------------

/**
 * Scan the added lines of a unified diff for case-insensitive substring matches against
 * a list of private repository names.
 *
 * - Only `+` lines are scanned (excluding `+++` headers).
 * - Returns which FILES contained a match, never which name matched.
 * - Override: if `override.titlePrefixed && override.isOperator` → bypass and return `{ok:true}`.
 */
export function checkPrivateLeak(
  privateNames: readonly string[],
  diff: string,
  override: OverrideOptions,
): GuardResult {
  // Honor override only when BOTH conditions hold.
  if (override.titlePrefixed && override.isOperator) {
    return {ok: true}
  }

  if (privateNames.length === 0 || diff.length === 0) {
    return {ok: true}
  }

  // Build lowercased name list once for efficiency.
  const lowerNames = privateNames.map(n => n.toLowerCase())

  const matchedFiles: string[] = []
  let currentFile: string | null = null

  for (const line of diff.split('\n')) {
    // Track current file from diff headers.
    if (line.startsWith('diff --git ')) {
      // Extract b/ path: `diff --git a/foo b/foo` → `foo`
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line)
      currentFile = match !== null && match[1] !== undefined ? match[1] : null
      continue
    }

    // Skip --- and +++ header lines.
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue
    }

    // Only scan added lines.
    if (!line.startsWith('+')) {
      continue
    }

    const content = line.slice(1).toLowerCase()
    const hasMatch = lowerNames.some(name => content.includes(name))

    if (hasMatch && currentFile !== null && !matchedFiles.includes(currentFile)) {
      matchedFiles.push(currentFile)
    }
  }

  if (matchedFiles.length === 0) {
    return {ok: true}
  }

  return {ok: false, matchedFiles}
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

interface PullRequestEventPayload {
  readonly pull_request?: {
    readonly number?: number
    readonly title?: string
    readonly user?: {readonly login?: string} | null
    readonly base?: {readonly repo?: {readonly full_name?: string} | null} | null
  }
}

async function readPullRequestContext(
  eventPath: string,
): Promise<{prNumber: number; title: string; author: string; fullName: string | null}> {
  const raw = await readFile(eventPath, 'utf8')
  const parsed = JSON.parse(raw) as PullRequestEventPayload
  const prNumber = parsed.pull_request?.number
  const title = parsed.pull_request?.title
  const author = parsed.pull_request?.user?.login
  if (typeof prNumber !== 'number' || typeof author !== 'string' || author === '') {
    throw new Error(
      `check-private-leak: event payload missing pull_request.number or pull_request.user.login (path=${eventPath})`,
    )
  }
  if (typeof title !== 'string') {
    throw new TypeError(`check-private-leak: event payload missing pull_request.title (path=${eventPath})`)
  }
  const rawFullName = parsed.pull_request?.base?.repo?.full_name
  const fullName = typeof rawFullName === 'string' && rawFullName.length > 0 ? rawFullName : null
  return {prNumber, title, author, fullName}
}

/**
 * Fetch metadata/repos.yaml from the `data` branch and return node_ids for private entries.
 */
function fetchPrivateNodeIds(fullName: string): string[] {
  const encoded = execFileSync(
    'gh',
    ['api', `repos/${fullName}/contents/metadata/repos.yaml?ref=data`, '--jq', '.content'],
    {encoding: 'utf8'},
  ).trim()

  // GitHub API returns base64 with potential embedded newlines.
  const yamlText = Buffer.from(encoded.replaceAll('\n', ''), 'base64').toString('utf8')
  const parsed = parseYaml(yamlText) as unknown
  assertReposFile(parsed)
  const repos = parsed.repos

  return repos
    .filter(r => r.private === true && typeof r.node_id === 'string' && r.node_id.length > 0)
    .map(r => r.node_id as string)
}

/**
 * Resolve a single node_id → nameWithOwner via GraphQL.
 * Returns null on failure (logs node_id only, never the name).
 */
function resolveNodeId(nodeId: string): string | null {
  try {
    const stdout = execFileSync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner } } }`,
        '-f',
        `id=${nodeId}`,
        '--jq',
        '.data.node.nameWithOwner',
      ],
      {encoding: 'utf8'},
    ).trim()

    // If the node doesn't resolve (not a Repository, deleted, etc.) jq returns "null".
    if (stdout === 'null' || stdout === '') {
      process.stderr.write(`check-private-leak: could not resolve node_id=${nodeId} (no nameWithOwner)\n`)
      return null
    }

    return stdout
  } catch {
    process.stderr.write(`check-private-leak: failed to resolve node_id=${nodeId}\n`)
    return null
  }
}

/**
 * Fetch unified diff text for a pull request.
 */
function fetchPrDiff(prNumber: number): string {
  return execFileSync('gh', ['pr', 'diff', String(prNumber)], {encoding: 'utf8'})
}

/**
 * Post a transparency comment on the PR about the override.
 */
function postOverrideComment(prNumber: number, author: string): void {
  const body = `⚠️ **[allow-private-leak] override honored** — \`${author}\` bypassed the private-leak guard on this PR. Operator-approved.`
  execFileSync(
    'gh',
    ['api', `repos/{owner}/{repo}/issues/${prNumber}/comments`, '--method', 'POST', '-f', `body=${body}`],
    {encoding: 'utf8'},
  )
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath === undefined || eventPath === '') {
    process.stderr.write(
      'check-private-leak: GITHUB_EVENT_PATH not set. This script must run inside a GitHub Actions pull_request event.\n',
    )
    process.exit(1)
  }

  const {prNumber, title, author, fullName: eventFullName} = await readPullRequestContext(eventPath)
  const fullName =
    eventFullName ??
    execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {encoding: 'utf8'}).trim()

  // Resolve private names from data branch.
  const privateNodeIds = fetchPrivateNodeIds(fullName)
  if (privateNodeIds.length === 0) {
    process.stdout.write('check-private-leak: no private entries found in metadata/repos.yaml — skipping scan\n')
    return
  }

  const privateNames: string[] = []
  for (const nodeId of privateNodeIds) {
    const name = resolveNodeId(nodeId)
    if (name !== null) {
      privateNames.push(name)
    }
  }

  if (privateNames.length === 0) {
    process.stdout.write('check-private-leak: all private node_ids failed to resolve — cannot scan, skipping\n')
    return
  }

  // Eval override.
  const titlePrefixed = title.startsWith('[allow-private-leak]')
  const isOperator = author === OPERATOR_LOGIN
  const override: OverrideOptions = {titlePrefixed, isOperator}

  // Fetch diff and evaluate.
  const diff = fetchPrDiff(prNumber)
  const result = checkPrivateLeak(privateNames, diff, override)

  if (result.ok) {
    if (titlePrefixed && isOperator) {
      process.stderr.write(
        `check-private-leak: ⚠️  override honored for operator ${author} — bypassing private-leak guard\n`,
      )
      try {
        postOverrideComment(prNumber, author)
      } catch {
        process.stderr.write('check-private-leak: could not post override transparency comment\n')
      }
    }
    process.stdout.write(`check-private-leak: ok (scanned ${privateNames.length} private name(s))\n`)
    return
  }

  // Failure: print file paths only, never the matched name.
  process.stderr.write('check-private-leak: FAILED — private repository name(s) detected in PR diff\n')
  process.stderr.write('\nMatched files:\n')
  for (const file of result.matchedFiles) {
    process.stderr.write(`  - ${file}\n`)
  }
  process.stderr.write('\nTo look up the private repository locally, run: node scripts/resolve-private.ts <node_id>\n')
  process.stderr.write('To bypass (operator only): prefix the PR title with [allow-private-leak] and re-run.\n')
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
