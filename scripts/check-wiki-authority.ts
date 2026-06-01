import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import process from 'node:process'

/**
 * Fro Bot identities permitted to commit autonomously-managed files on `main`.
 *
 * Kept symmetric with `EXPECTED_AUTHORS` in `scripts/reconcile-repos.ts` so the two
 * enforcement points (pre-commit integrity check on `data` and pre-merge PR guard on
 * `main`) share one operator model. If this set ever changes, change both files.
 */
const FROBOT_AUTHORS: ReadonlySet<string> = new Set(['fro-bot', 'fro-bot[bot]'])

/**
 * Anchored patterns for files whose only legitimate writer is Fro Bot.
 *
 * - `knowledge/wiki/<subdir>/*.md` is agent-authored content — pages live in
 *   `repos/`, `topics/`, `entities/`, and `comparisons/` subdirectories per the
 *   Karpathy schema. Top-level `knowledge/wiki/README.md` is human scaffolding.
 * - `knowledge/index.md` and `knowledge/log.md` are auto-maintained catalog and journal.
 * - `metadata/*.yaml` are all auto-managed state. Manual edits to allowlist.yaml or
 *   any other metadata YAML still land via the `data` branch and are promoted by the
 *   `Merge Data Branch` workflow under the `fro-bot[bot]` identity.
 *
 * Docs (`knowledge/schema.md`, `knowledge/README.md`, `knowledge/wiki/README.md`,
 * `metadata/README.md`) are intentionally NOT covered.
 */
const GUARDED_PATTERNS: readonly RegExp[] = [
  /^knowledge\/wiki\/[^/]+\/.+\.md$/,
  /^knowledge\/index\.md$/,
  /^knowledge\/log\.md$/,
  /^metadata\/[^/]+\.yaml$/,
]

export interface GuardInput {
  readonly author: string
  readonly headRef: string
  readonly files: readonly string[]
}

export type GuardResult = {readonly ok: true} | {readonly ok: false; readonly blockedFiles: readonly string[]}

/**
 * Pure decision function: should this PR be allowed to touch autonomously-managed files?
 *
 * Rules:
 * - If the author is a Fro Bot identity, always allow. Fro Bot is the legitimate writer.
 * - Otherwise, reject if any changed file matches a guarded pattern. The PR must split
 *   its guarded edits onto the `data` branch and let the promotion flow land them.
 *
 * Returns `{ok: true}` on allow, `{ok: false, blockedFiles}` listing the offending paths
 * in input order. Mixed PRs (some guarded, some not) still fail; splitting the PR is the
 * intended resolution.
 */
export function checkWikiAuthority(input: GuardInput): GuardResult {
  if (FROBOT_AUTHORS.has(input.author)) {
    // metadata/repos.yaml may only arrive via the `data` promotion branch.
    // Any other head branch from a fro-bot identity is the prohibited both-sides mutation.
    // The `headRef !== 'data'` bypass is safe to gate on a branch name only because a
    // fro-bot identity never originates from a fork — fork PRs carry an external author and
    // fall through to the GUARDED_PATTERNS check below, so a fork naming its branch `data`
    // cannot reach this allow path.
    if (input.files.includes('metadata/repos.yaml') && input.headRef !== 'data') {
      return {ok: false, blockedFiles: ['metadata/repos.yaml']}
    }
    return {ok: true}
  }
  const blockedFiles = input.files.filter(f => GUARDED_PATTERNS.some(p => p.test(f)))
  if (blockedFiles.length === 0) {
    return {ok: true}
  }
  return {ok: false, blockedFiles}
}

/**
 * Render the failure message the CI job surfaces when a PR hits the guard.
 *
 * Content contract (enforced by tests):
 * - lists every blocked file
 * - names the `data` branch as the resubmission path
 * - names both `fro-bot` and `fro-bot[bot]` so the reader sees the identity equivalence
 */
export function formatBlockMessage(result: {readonly ok: false; readonly blockedFiles: readonly string[]}): string {
  const lines = [
    'Cannot merge: this PR modifies files that are auto-managed by Fro Bot workflows.',
    '',
    'Blocked files:',
    ...result.blockedFiles.map(f => `  - ${f}`),
    '',
    'These paths are writable only by `fro-bot` (PAT writes) or `fro-bot[bot]` (App writes)',
    'via the `data` branch. Authorized manual edits land like this:',
    '',
    '  1. Check out `data` in a worktree (`git worktree add ../worktree-data data`)',
    '  2. Make the edit there',
    '  3. Push `data` to origin',
    '  4. The Merge Data Branch workflow opens a promotion PR from `data` → `main`',
    '',
    'See metadata/README.md and knowledge/schema.md for the operator workflow.',
  ]
  return lines.join('\n')
}

interface PullRequestEventPayload {
  readonly pull_request?: {
    readonly number?: number
    readonly user?: {readonly login?: string} | null
    readonly head?: {readonly ref?: string} | null
    readonly base?: {readonly repo?: {readonly full_name?: string} | null} | null
  }
}

async function readPullRequestContext(
  eventPath: string,
): Promise<{prNumber: number; author: string; headRef: string; fullName: string | null}> {
  const raw = await readFile(eventPath, 'utf8')
  const parsed = JSON.parse(raw) as PullRequestEventPayload
  const prNumber = parsed.pull_request?.number
  const author = parsed.pull_request?.user?.login
  const headRef = parsed.pull_request?.head?.ref
  if (typeof prNumber !== 'number' || typeof author !== 'string' || author === '') {
    throw new Error(
      `check-wiki-authority: event payload missing pull_request.number or pull_request.user.login (path=${eventPath})`,
    )
  }
  if (typeof headRef !== 'string' || headRef === '') {
    throw new Error(`check-wiki-authority: event payload missing pull_request.head.ref (path=${eventPath})`)
  }
  const rawFullName = parsed.pull_request?.base?.repo?.full_name
  const fullName = typeof rawFullName === 'string' && rawFullName.length > 0 ? rawFullName : null
  return {prNumber, author, headRef, fullName}
}

/**
 * Fetch the complete list of changed files for a pull request using the paginated GitHub API.
 *
 * Uses `gh api --paginate` so files beyond GitHub's first-page soft limit are always included.
 * `{fullName}` is the `owner/repo` string sourced from the event payload's
 * `pull_request.base.repo.full_name` field; falls back to `gh repo view` when the payload
 * does not carry it (e.g. re-triggered workflows).
 *
 * Exported for unit testing.
 */
export function fetchChangedFiles(prNumber: number, fullName: string): string[] {
  const stdout = execFileSync(
    'gh',
    ['api', '--paginate', `/repos/${fullName}/pulls/${prNumber}/files`, '--jq', '.[].filename'],
    {encoding: 'utf8'},
  )
  return stdout.split('\n').filter(line => line.length > 0)
}

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath === undefined || eventPath === '') {
    process.stderr.write(
      'check-wiki-authority: GITHUB_EVENT_PATH not set. This script must run inside a GitHub Actions pull_request event.\n',
    )
    process.exit(1)
  }

  const {prNumber, author, headRef, fullName: eventFullName} = await readPullRequestContext(eventPath)
  const fullName =
    eventFullName ??
    execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {encoding: 'utf8'}).trim()
  const files = fetchChangedFiles(prNumber, fullName)
  const result = checkWikiAuthority({author, headRef, files})

  if (result.ok) {
    process.stdout.write(`check-wiki-authority: ok (author=${author}, files_checked=${files.length})\n`)
    return
  }

  process.stderr.write(`${formatBlockMessage(result)}\n`)
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
