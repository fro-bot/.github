import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import process from 'node:process'

/**
 * Fro Bot identities permitted to commit autonomously-managed files on `main`.
 *
 * Kept symmetric with `EXPECTED_AUTHORS` in `scripts/reconcile-repos.ts` so the two
 * enforcement points (pre-commit integrity check on `data` and pre-merge PR guard on
 * `main`) share one operator model. If this set ever changes, change both files.
 *
 * Function, not const: static-mutant workaround — see `operatorLogin()` in
 * `scripts/check-private-leak.ts` and `size-subprocess-buffers-selectively-at-call-sites-2026-08-31.md`.
 */
function frobotAuthors(): ReadonlySet<string> {
  return new Set(['fro-bot', 'fro-bot[bot]'])
}

/**
 * Anchored patterns for files whose only legitimate writer is Fro Bot.
 *
 * - `knowledge/wiki/<subdir>/*.md` is agent-authored content — pages live in
 *   `repos/`, `topics/`, `entities/`, and `comparisons/` subdirectories per the
 *   Karpathy schema. Top-level `knowledge/wiki/README.md` is human scaffolding.
 * - `knowledge/index.md` and `knowledge/log.md` are auto-maintained catalog and journal.
 * - `knowledge/corrections.yaml` is system-owned sidecar state for marked corrections.
 * - `metadata/*.{yaml,yml}` are all auto-managed state (including `repos.yaml`). Manual edits
 *   to allowlist.yaml or any other metadata YAML still land via the `data` branch and are
 *   promoted by the `Merge Data Branch` workflow under the `fro-bot[bot]` identity.
 *
 * Docs (`knowledge/schema.md`, `knowledge/README.md`, `knowledge/wiki/README.md`,
 * `metadata/README.md`) are intentionally NOT covered.
 *
 * Function, not const: same static-mutant workaround as `frobotAuthors()` above.
 */
function guardedPatterns(): readonly RegExp[] {
  return [
    /^knowledge\/wiki\/[^/]+\/.+\.md$/,
    /^knowledge\/index\.md$/,
    /^knowledge\/log\.md$/,
    /^knowledge\/corrections\.yaml$/,
    /^metadata\/[^/]+\.ya?ml$/,
  ]
}

export interface GuardInput {
  readonly author: string
  // `unknown`, not `string`: the pure function is the trust boundary, so it narrows rather than
  // trusting the caller's type. See exact-match-trust-gates-need-type-discipline-2026-09-08.md.
  readonly headRef: unknown
  readonly files: readonly string[]
}

export type GuardResult = {readonly ok: true} | {readonly ok: false; readonly blockedFiles: readonly string[]}

/**
 * Pure decision function: should this PR be allowed to touch autonomously-managed files?
 *
 * Rules:
 * - A Fro Bot identity may touch guarded paths only from the `data` head branch (the
 *   writers all target `data`; `main` receives them through the promotion PR). Any guarded
 *   path on another head, or a `headRef` that is not exactly the string `data`, is blocked.
 *   Fro Bot with only unguarded paths is allowed on any head.
 * - Any other author is blocked if any changed file matches a guarded pattern, whatever the
 *   head. The PR must split its guarded edits onto the `data` branch and let the promotion
 *   flow land them.
 *
 * Returns `{ok: true}` on allow, `{ok: false, blockedFiles}` listing the offending (guarded)
 * paths in input order. Mixed PRs (some guarded, some not) still fail; splitting the PR is the
 * intended resolution.
 *
 * Gating a Fro Bot allow on a branch name is safe only because a Fro Bot identity never
 * originates from a fork: fork PRs carry an external author and take the non-Fro-Bot branch,
 * so a fork naming its branch `data` cannot reach the allow path.
 */
export function checkWikiAuthority(input: GuardInput): GuardResult {
  const patterns = guardedPatterns()
  const guardedFiles = input.files.filter(f => patterns.some(p => p.test(f)))
  if (guardedFiles.length === 0) {
    return {ok: true}
  }
  // Strict `===` against a string literal is the narrowing: it is true only for the primitive
  // string `data` (not `['data']`, not a `String` object), so a separate `typeof` check would be
  // dead code whose mutant is equivalent and unkillable.
  if (frobotAuthors().has(input.author) && input.headRef === 'data') {
    return {ok: true}
  }
  return {ok: false, blockedFiles: guardedFiles}
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
  // Own line, own mutants (a `-` prefix and a `\n` join), so the template below stays a single
  // StringLiteral node with no interpolation sharing its line.
  const fileList = result.blockedFiles.map(f => `  - ${f}`).join('\n')
  // No directive: the whole template is one StringLiteral mutant (Stryker replaces it entirely
  // with `Stryker was here!`), and every existing content-contract assertion below (blocked-file
  // names, `fro-bot`/`fro-bot[bot]`, "data branch", length > 50) already fails under that mutant.
  return `Cannot merge: this PR modifies files that are auto-managed by Fro Bot workflows.

Blocked files:
${fileList}

These paths are writable only by Fro Bot (\`fro-bot\` / \`fro-bot[bot]\`), and only from the \`data\`
branch (enforced by the \`data\` branch ruleset). Authorized manual edits land like this:

  1. Check out \`data\` in a worktree (\`git worktree add ../worktree-data data\`)
  2. Make the edit there
  3. Push \`data\` to origin, authenticated as the Fro Bot App (a personal push is rejected)
  4. The Merge Data Branch workflow opens a promotion PR from \`data\` → \`main\`

See metadata/README.md and knowledge/schema.md for the operator workflow.`
}

interface PullRequestEventPayload {
  readonly pull_request?: {
    readonly number?: number
    readonly user?: {readonly login?: string} | null
    readonly head?: {readonly ref?: string} | null
    readonly base?: {readonly repo?: {readonly full_name?: string} | null} | null
  }
}

/**
 * Exported so `scripts/check-mutation-guards.ts`'s changed-file trigger gate can reuse the
 * same `pull_request` event payload parsing rather than duplicating it — both checks run on
 * the same event shape and need the same fields (`prNumber`, `fullName`).
 */
export async function readPullRequestContext(
  eventPath: string,
): Promise<{prNumber: number; author: string; headRef: string; fullName: string | null}> {
  // Buffer.toString() defaults to utf8; no encoding literal to mutate.
  const raw = await readFile(eventPath)
  const parsed = JSON.parse(raw.toString()) as PullRequestEventPayload
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
  // pull_request is defined: prNumber above threw otherwise.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const rawFullName = parsed.pull_request!.base?.repo?.full_name
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
