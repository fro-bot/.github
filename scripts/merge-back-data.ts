/**
 * Merges `main` into `data` at the start of every merge-data run.
 *
 * - Writes one commit on `data` with parents `[main, data]`: `main`'s tree, with every data-owned path
 *   (`isDataOwnedPath`) taken from `data`. Nothing is written when `data` already contains `main`.
 * - Fails closed, filing an alert and writing nothing, when an unowned path on `data` differs from both
 *   the merge base and `main`. Checked on every run.
 * - Retries only on an `updateRef` 409/422, up to 3 attempts, re-reading everything each time. It never
 *   forces the ref update.
 * - Errors reach output as a fixed code, plus the HTTP status when the API returned one, and never as an
 *   upstream message.
 */

import process from 'node:process'

import {assertBranchWritable} from '@fro.bot/wiki-write-core'

import {isDataOwnedPath} from './check-wiki-authority.ts'
import {bootstrapDataBranch, DataBranchBootstrapError} from './data-branch-bootstrap.ts'
import {upsertAlertIssue} from './merge-data-pr.ts'

type EntryMode = '100644' | '100755' | '120000' | '160000'
type EntryType = 'blob' | 'commit'

/** One path's tree entry. Two entries are the same only when sha, mode and type all agree. */
interface Entry {
  readonly mode: EntryMode
  readonly type: EntryType
  readonly sha: string
}

interface Tree {
  readonly sha: string
  /** Every non-directory entry, by path. */
  readonly entries: ReadonlyMap<string, Entry>
}

interface TreeItem {
  path: string
  mode: EntryMode
  type: EntryType
  sha: string | null
}

/** Parse a tree entry from an untrusted response: only file-like entries (not directories) are accepted. */
function parseEntry(item: {path?: string; mode?: string; type?: string; sha?: string}): [string, Entry] {
  const {path, mode, type, sha} = item
  if (path === undefined || sha === undefined) throw new MergeBackError('TREE_MALFORMED')
  if (type !== 'blob' && type !== 'commit') throw new MergeBackError('TREE_MALFORMED')
  if (mode !== '100644' && mode !== '100755' && mode !== '120000' && mode !== '160000') {
    throw new MergeBackError('TREE_MALFORMED')
  }
  return [path, {mode, type, sha}]
}

/** The Git Data and compare calls the writer needs, structurally satisfied by Octokit. */
export interface MergeBackClient {
  rest: {
    repos: {
      getBranch: (params: {owner: string; repo: string; branch: string}) => Promise<{
        data: {protected?: boolean; protection?: {enabled?: boolean} | null}
      }>
      compareCommitsWithBasehead: (params: {owner: string; repo: string; basehead: string}) => Promise<{
        data: {merge_base_commit: {sha: string}}
      }>
    }
    git: {
      getRef: (params: {owner: string; repo: string; ref: string}) => Promise<{data: {object: {sha: string}}}>
      getCommit: (params: {owner: string; repo: string; commit_sha: string}) => Promise<{
        data: {tree: {sha: string}}
      }>
      getTree: (params: {owner: string; repo: string; tree_sha: string; recursive?: string}) => Promise<{
        data: {truncated: boolean; tree: {path?: string; mode?: string; type?: string; sha?: string}[]}
      }>
      createTree: (params: {owner: string; repo: string; base_tree: string; tree: TreeItem[]}) => Promise<{
        data: {sha: string}
      }>
      createCommit: (params: {
        owner: string
        repo: string
        message: string
        tree: string
        parents: string[]
        author: {name: string; email: string}
        committer: {name: string; email: string}
      }) => Promise<{data: {sha: string}}>
      updateRef: (params: {
        owner: string
        repo: string
        ref: string
        sha: string
        /** Non-force only: a forced update would overwrite a concurrent `data` write. */
        force: false
      }) => Promise<{data: unknown}>
    }
  }
}

export interface MergeBackAlert {
  readonly title: string
  readonly body: string
}

export interface MergeBackParams {
  readonly client: MergeBackClient
  readonly owner: string
  readonly repo: string
  /** Create `data` from `main` when it is missing. */
  readonly bootstrapDataBranch: () => Promise<void>
  /** File or update the deduplicated operator alert. */
  readonly fileAlert: (alert: MergeBackAlert) => Promise<void>
}

export type MergeBackOutcome =
  | {readonly result: 'noop'}
  | {readonly result: 'merged'; readonly commit: string; readonly attempts: number}
  | {readonly result: 'blocked'; readonly paths: readonly string[]}

/** One attempt's result: a final outcome, or `updateRef` saying the branch moved (409) or the update is not a fast-forward (422). */
type AttemptResult = MergeBackOutcome | {readonly result: 'raced'; readonly status: number}

export type MergeBackErrorCode = 'TREE_TRUNCATED' | 'TREE_MALFORMED' | 'PROTECTED_BRANCH' | 'RETRIES_EXHAUSTED'

export class MergeBackError extends Error {
  readonly code: MergeBackErrorCode
  readonly status: number | undefined

  constructor(code: MergeBackErrorCode, status?: number) {
    super(status === undefined ? `merge-back-data: ${code}` : `merge-back-data: ${code} (status=${status})`)
    this.name = 'MergeBackError'
    this.code = code
    this.status = status
  }
}

/** The App, as author and committer: the reconcile integrity check reads the `data` tip's author. */
function botIdentity(): {name: string; email: string} {
  return {name: 'fro-bot[bot]', email: '109017866+fro-bot[bot]@users.noreply.github.com'}
}

function maxAttempts(): number {
  return 3
}

/** Paths listed in the alert body; the rest are counted. */
function maxAlertPaths(): number {
  return 20
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function sameEntry(left: Entry | undefined, right: Entry | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.sha === right.sha && left.mode === right.mode && left.type === right.type
}

async function readTree(params: MergeBackParams, commitSha: string): Promise<Tree> {
  const {client, owner, repo} = params
  const commit = await client.rest.git.getCommit({owner, repo, commit_sha: commitSha})
  const treeSha = commit.data.tree.sha
  const tree = await client.rest.git.getTree({owner, repo, tree_sha: treeSha, recursive: 'true'})
  // A truncated tree would hide paths from the unowned-change check and from the merge: fail closed.
  if (tree.data.truncated) throw new MergeBackError('TREE_TRUNCATED')

  const entries = new Map<string, Entry>()
  for (const item of tree.data.tree) {
    if (item.type === 'tree') continue
    const [path, entry] = parseEntry(item)
    entries.set(path, entry)
  }
  return {sha: treeSha, entries}
}

/** The `data` tip, bootstrapping the branch from `main` when it is missing. */
async function readDataTip(params: MergeBackParams): Promise<string> {
  const read = async (): Promise<string> =>
    (await params.client.rest.git.getRef({owner: params.owner, repo: params.repo, ref: 'heads/data'})).data.object.sha
  try {
    return await read()
  } catch (error: unknown) {
    if (statusOf(error) !== 404) throw error
  }
  await params.bootstrapDataBranch()
  return read()
}

/**
 * Unowned paths where `data` differs from BOTH the merge base and `main` (absence counts as a
 * value). A path `data` left alone, or changed to exactly what `main` has, is not a violation.
 */
function findUnownedChanges(base: Tree, main: Tree, data: Tree): string[] {
  const paths = new Set([...data.entries.keys(), ...base.entries.keys()])
  return [...paths]
    .filter(path => !isDataOwnedPath(path))
    .filter(path => {
      const onData = data.entries.get(path)
      return !sameEntry(onData, base.entries.get(path)) && !sameEntry(onData, main.entries.get(path))
    })
    .sort()
}

/** Tree changes on top of `main`'s tree: each owned path takes `data`'s entry, or is deleted. */
function planOwnedPaths(main: Tree, data: Tree): TreeItem[] {
  const paths = new Set([...data.entries.keys(), ...main.entries.keys()])
  const items: TreeItem[] = []
  for (const path of [...paths].filter(candidate => isDataOwnedPath(candidate)).sort()) {
    const onData = data.entries.get(path)
    if (sameEntry(onData, main.entries.get(path))) continue
    items.push(
      onData === undefined
        ? {path, mode: '100644', type: 'blob', sha: null}
        : {path, mode: onData.mode, type: onData.type, sha: onData.sha},
    )
  }
  return items
}

function buildAlert(paths: readonly string[]): MergeBackAlert {
  const shown = paths.slice(0, maxAlertPaths())
  const hidden = paths.length - shown.length
  return {
    title: 'Data merge-back blocked: unowned changes on data',
    body: [
      `The merge-back of \`main\` into \`data\` wrote nothing: ${paths.length} path(s) outside the data-owned set changed on \`data\` to content that neither the merge base nor \`main\` holds.`,
      '',
      ...shown.map(path => `- \`${path}\``),
      ...(hidden > 0 ? [`- and ${hidden} more`] : []),
      '',
      'Only the Fro Bot App writes `data`. Land the same content on `main` through an ordinary pull request, or ask the writer to stop touching these paths. Later merge-data runs stay blocked until then.',
    ].join('\n'),
  }
}

async function attemptMergeBack(params: MergeBackParams, attempt: number): Promise<AttemptResult> {
  const {client, owner, repo} = params
  const mainSha = (await client.rest.git.getRef({owner, repo, ref: 'heads/main'})).data.object.sha
  const dataSha = await readDataTip(params)
  const comparison = await client.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${mainSha}...${dataSha}`,
  })
  const baseSha = comparison.data.merge_base_commit.sha

  const base = await readTree(params, baseSha)
  const main = await readTree(params, mainSha)
  const data = await readTree(params, dataSha)

  const unowned = findUnownedChanges(base, main, data)
  if (unowned.length > 0) {
    await params.fileAlert(buildAlert(unowned))
    return {result: 'blocked', paths: unowned}
  }

  // `data` contains `main` exactly when their merge base is `main`'s tip.
  if (baseSha === mainSha) return {result: 'noop'}

  await assertBranchWritable(client, owner, repo, 'data', () => {
    throw new MergeBackError('PROTECTED_BRANCH')
  })

  const items = planOwnedPaths(main, data)
  // An empty `tree` is not a valid createTree request: with nothing to change, `main`'s tree is the tree.
  const treeSha =
    items.length === 0
      ? main.sha
      : (await client.rest.git.createTree({owner, repo, base_tree: main.sha, tree: items})).data.sha
  const commit = await client.rest.git.createCommit({
    owner,
    repo,
    message: 'chore(data): merge main into data',
    tree: treeSha,
    parents: [mainSha, dataSha],
    author: botIdentity(),
    committer: botIdentity(),
  })

  try {
    await client.rest.git.updateRef({owner, repo, ref: 'heads/data', sha: commit.data.sha, force: false})
  } catch (error: unknown) {
    const status = statusOf(error)
    if (status === 409 || status === 422) return {result: 'raced', status}
    throw error
  }
  return {result: 'merged', commit: commit.data.sha, attempts: attempt}
}

export async function mergeBackData(params: MergeBackParams): Promise<MergeBackOutcome> {
  let lastRace = 409
  for (let attempt = 1; attempt <= maxAttempts(); attempt += 1) {
    const result = await attemptMergeBack(params, attempt)
    if (result.result !== 'raced') return result
    lastRace = result.status
  }
  throw new MergeBackError('RETRIES_EXHAUSTED', lastRace)
}

/**
 * The CLI entry. `GITHUB_TOKEN` is the App token (contents, pull-requests and issues write).
 * Returns the exit code; a blocked or failed merge-back is non-zero so the job stops before the
 * privacy gates, the promotion compare and the PR.
 */
export async function runCli(env: Record<string, string | undefined>): Promise<number> {
  const fail = (line: string): number => {
    process.stderr.write(`::error::merge-back-data: ${line}\n`)
    return 1
  }

  const token = env.GITHUB_TOKEN
  if (token === undefined || token === '') return fail('MISSING_TOKEN')

  try {
    const {Octokit} = await import('@octokit/rest')
    const octokit = new Octokit({auth: token})
    const owner = 'fro-bot'
    const repo = '.github'
    const outcome = await mergeBackData({
      client: octokit,
      owner,
      repo,
      bootstrapDataBranch: async () => {
        await bootstrapDataBranch({owner, repo, octokit})
      },
      fileAlert: async alert => {
        await upsertAlertIssue({octokit, owner, repo, ...alert})
      },
    })

    if (outcome.result === 'blocked') {
      return fail(`BLOCKED (unowned_paths=${outcome.paths.length}). Nothing was written; an alert issue was filed.`)
    }
    process.stdout.write(
      outcome.result === 'noop'
        ? '{"result":"noop"}\n'
        : `${JSON.stringify({result: 'merged', attempts: outcome.attempts, commit: outcome.commit})}\n`,
    )
    return 0
  } catch (error: unknown) {
    if (error instanceof MergeBackError) return fail(error.message.replace('merge-back-data: ', ''))
    if (error instanceof DataBranchBootstrapError) return fail(`BOOTSTRAP_${error.code}`)
    const status = statusOf(error)
    return fail(status === undefined ? 'UNEXPECTED_FAILURE' : `API_ERROR (status=${status})`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.env)
}
