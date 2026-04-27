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
 * - `knowledge/index.md` and `knowledge/log.md` are auto-maintained catalog and journal
 * - `metadata/repos.yaml` and `metadata/social-cooldowns.yaml` are autonomous state
 *
 * Human-editable config files (`metadata/allowlist.yaml`, `metadata/renovate.yaml`)
 * and docs (`knowledge/schema.md`, `knowledge/README.md`, `knowledge/wiki/README.md`,
 * `metadata/README.md`) are intentionally NOT covered.
 */
const GUARDED_PATTERNS: readonly RegExp[] = [
  /^knowledge\/wiki\/[^/]+\/.+\.md$/,
  /^knowledge\/index\.md$/,
  /^knowledge\/log\.md$/,
  /^metadata\/repos\.yaml$/,
  /^metadata\/social-cooldowns\.yaml$/,
]

export interface GuardInput {
  readonly author: string
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
  }
}

async function readPullRequestContext(eventPath: string): Promise<{prNumber: number; author: string}> {
  const raw = await readFile(eventPath, 'utf8')
  const parsed = JSON.parse(raw) as PullRequestEventPayload
  const prNumber = parsed.pull_request?.number
  const author = parsed.pull_request?.user?.login
  if (typeof prNumber !== 'number' || typeof author !== 'string' || author === '') {
    throw new Error(
      `check-wiki-authority: event payload missing pull_request.number or pull_request.user.login (path=${eventPath})`,
    )
  }
  return {prNumber, author}
}

function fetchChangedFiles(prNumber: number): string[] {
  // `gh pr view` with --json files returns paginated results. For PRs under GitHub's
  // default per-file soft limit this single-page view is sufficient; if it ever proves
  // insufficient, swap to `gh api --paginate /repos/{owner}/{repo}/pulls/{n}/files`.
  const stdout = execFileSync('gh', ['pr', 'view', String(prNumber), '--json', 'files', '--jq', '.files[].path'], {
    encoding: 'utf8',
  })
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

  const {prNumber, author} = await readPullRequestContext(eventPath)
  const files = fetchChangedFiles(prNumber)
  const result = checkWikiAuthority({author, files})

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
