/**
 * An in-memory Git Data API for tests: a blob/tree/commit store behind the same call shapes the
 * Git Data writers use, with a real fast-forward check on `updateRef`.
 *
 * It exists so a writer is exercised against git's actual rules (a non-fast-forward update is a
 * 422, a stale `base_tree` is not silently merged, a recursive tree read lists directories too)
 * rather than against canned responses. It holds several branches over one commit graph, so a
 * test can build `main` and `data` histories that diverge from a shared base, and it answers
 * `compareCommitsWithBasehead` with the merge base. Test support only: no production module
 * imports it.
 */

import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'

export interface FakeTreeEntry {
  readonly path: string
  readonly mode: string
  readonly type: string
  readonly sha: string
}

/**
 * A file's content, or its content with an explicit tree mode/type. A `type: 'commit'` entry (a
 * submodule) takes its `content` as the literal commit sha it points at.
 */
export type FileSpec = string | {readonly content: string; readonly mode?: string; readonly type?: string}

/** A change to one path: set it, or delete it with `null`. */
export type FileChange = FileSpec | null

interface StoredCommit {
  readonly tree: string
  readonly parents: readonly string[]
  readonly message: string
  readonly authorLogin: string
}

export interface FakeCall {
  readonly method: string
  readonly args: Record<string, unknown>
}

export interface GitDataFakeOptions {
  /** Files on the branch before the first call. */
  readonly files?: Readonly<Record<string, FileSpec>>
  /** The default branch: the one `advance`, `files`, `head`, `truncate` and `beforeUpdateRef` act on. */
  readonly branch?: string
  /** Login recorded as the author of the seed commit and of `advance()` commits by default. */
  readonly authorLogin?: string
  readonly protectedBranch?: boolean
}

export interface CommitOptions {
  readonly message?: string
  readonly authorLogin?: string
}

export interface GitDataFake {
  readonly client: FakeClient
  /** Every API call, in order. */
  readonly calls: readonly FakeCall[]
  /** Current content of every file on a branch (default: the default branch). */
  files: (ref?: string) => Record<string, string>
  /** Every non-directory tree entry on a branch, with its mode and type. */
  entries: (ref?: string) => FakeTreeEntry[]
  head: (ref?: string) => string
  hasBranch: (ref: string) => boolean
  /** Point a new branch at `from`'s head (default: the default branch). */
  createBranch: (name: string, from?: string) => string
  deleteBranch: (name: string) => void
  /** Commit `changes` on top of a branch's head and move the branch there. */
  commit: (ref: string, changes: Readonly<Record<string, FileChange>>, options?: CommitOptions) => string
  commitCount: () => number
  parentsOf: (sha: string) => readonly string[]
  messageOf: (sha: string) => string
  /** Make `getTree` report `truncated: true` and return only part of the tree. */
  truncate: (on: boolean) => void
  /** Move the default branch forward with a commit made by someone else (a concurrent writer). */
  advance: (files: Readonly<Record<string, FileChange>>, options?: CommitOptions) => string
  /** Run `hook` immediately before the n-th (1-based) `updateRef`, e.g. to `advance()` the branch. */
  beforeUpdateRef: (attempt: number, hook: () => void) => void
  /** Fail the next call to `method` with an HTTP-style error. */
  failNext: (method: string, status: number, message?: string) => void
}

interface FakeTreeItem {
  path?: string
  mode?: string
  type?: string
  sha?: string | null
}

interface RepoParams {
  owner: string
  repo: string
}

/**
 * The client the fake presents: the union of the call shapes the Git Data writers use. Parameter
 * types are the widest any writer sends, so the fake is assignable to each writer's own client
 * type, and a change to what a writer calls fails to compile against it.
 */
export interface FakeClient {
  rest: {
    repos: {
      getBranch: (params: RepoParams & {branch: string}) => Promise<{
        data: {
          name: string
          protected?: boolean
          protection?: {enabled?: boolean}
          commit: {sha: string; author?: {login?: string} | null}
        }
      }>
      compareCommitsWithBasehead: (params: RepoParams & {basehead: string}) => Promise<{
        data: {merge_base_commit: {sha: string}; ahead_by: number; behind_by: number}
      }>
    }
    git: {
      getRef: (params: RepoParams & {ref: string}) => Promise<{data: {object: {sha: string}}}>
      getCommit: (params: RepoParams & {commit_sha: string}) => Promise<{data: {sha: string; tree: {sha: string}}}>
      getTree: (params: RepoParams & {tree_sha: string; recursive?: string}) => Promise<{
        data: {sha: string; truncated: boolean; tree: {path?: string; mode?: string; type?: string; sha?: string}[]}
      }>
      getBlob: (params: RepoParams & {file_sha: string}) => Promise<{data: {content: string; encoding: string}}>
      createBlob: (params: RepoParams & {content: string; encoding?: string}) => Promise<{data: {sha: string}}>
      createTree: (params: RepoParams & {base_tree?: string; tree: FakeTreeItem[]}) => Promise<{data: {sha: string}}>
      createCommit: (
        params: RepoParams & {
          message: string
          tree: string
          parents?: string[]
          author?: {name: string; email: string}
          committer?: {name: string; email: string}
        },
      ) => Promise<{data: {sha: string}}>
      createRef: (params: RepoParams & {ref: string; sha: string}) => Promise<{data: {ref: string}}>
      updateRef: (
        params: RepoParams & {
          ref: string
          sha: string
          /** Non-force only: a forced update would overwrite a concurrent commit. */
          force?: false
        },
      ) => Promise<{data: unknown}>
    }
  }
}

const EMPTY_TREE = new Map<string, FakeTreeEntry>()

function sha1(...parts: string[]): string {
  const hash = createHash('sha1')
  for (const part of parts) hash.update(`${part.length}:${part}`)
  return hash.digest('hex')
}

function directChildren(entries: readonly FakeTreeEntry[]): FakeTreeEntry[] {
  const children = new Map<string, FakeTreeEntry>()
  for (const entry of entries) {
    const slash = entry.path.indexOf('/')
    if (slash === -1) {
      children.set(entry.path, entry)
      continue
    }
    const directory = entry.path.slice(0, slash)
    children.set(directory, directoryEntry(directory, entries))
  }
  return [...children.values()].sort((left, right) => left.path.localeCompare(right.path))
}

/** A `tree` entry whose sha follows the content below it, so a stale directory sha is detectable. */
function directoryEntry(directory: string, entries: readonly FakeTreeEntry[]): FakeTreeEntry {
  const below = entries
    .filter(entry => entry.path.startsWith(`${directory}/`))
    .map(entry => `${entry.path}\0${entry.mode}\0${entry.type}\0${entry.sha}`)
    .sort()
  return {path: directory, mode: '040000', type: 'tree', sha: sha1('tree', directory, ...below)}
}

/** Every file entry plus every directory entry above it, as the real API lists a recursive read. */
function withDirectories(entries: readonly FakeTreeEntry[]): FakeTreeEntry[] {
  const directories = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    for (let depth = 1; depth < parts.length; depth += 1) directories.add(parts.slice(0, depth).join('/'))
  }
  return [...entries, ...[...directories].map(directory => directoryEntry(directory, entries))]
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), {status})
}

export function createGitDataFake(options: GitDataFakeOptions = {}): GitDataFake {
  const branch = options.branch ?? 'data'
  const defaultAuthor = options.authorLogin ?? 'fro-bot[bot]'
  const blobs = new Map<string, string>()
  const trees = new Map<string, Map<string, FakeTreeEntry>>()
  const commits = new Map<string, StoredCommit>()
  const refs = new Map<string, string>()
  const calls: FakeCall[] = []
  const failures = new Map<string, {status: number; message: string}>()
  const updateHooks = new Map<number, () => void>()
  let truncated = false
  let updateRefCalls = 0
  let counter = 0

  const storeBlob = (content: string): string => {
    const sha = sha1('blob', content)
    blobs.set(sha, content)
    return sha
  }

  const storeTree = (entries: Map<string, FakeTreeEntry>): string => {
    const sha = sha1(
      'tree',
      ...[...entries.values()].map(entry => `${entry.path}\0${entry.mode}\0${entry.type}\0${entry.sha}`).sort(),
    )
    trees.set(sha, entries)
    return sha
  }

  const storeCommit = (commit: StoredCommit): string => {
    counter += 1
    const sha = sha1('commit', commit.tree, ...commit.parents, commit.message, String(counter))
    commits.set(sha, commit)
    return sha
  }

  const entryFor = (path: string, spec: FileSpec): FakeTreeEntry => {
    if (typeof spec === 'string') return {path, mode: '100644', type: 'blob', sha: storeBlob(spec)}
    const type = spec.type ?? 'blob'
    // A submodule entry points at a commit that is not in this store: its content is the sha.
    return {path, mode: spec.mode ?? '100644', type, sha: type === 'commit' ? spec.content : storeBlob(spec.content)}
  }

  const treeFromFiles = (files: Readonly<Record<string, FileSpec>>): string => {
    const entries = new Map<string, FakeTreeEntry>()
    for (const [path, spec] of Object.entries(files)) entries.set(path, entryFor(path, spec))
    return storeTree(entries)
  }

  refs.set(
    branch,
    storeCommit({
      tree: treeFromFiles(options.files ?? {}),
      parents: [],
      message: 'seed',
      authorLogin: defaultAuthor,
    }),
  )

  const record = (method: string, args: object): void => {
    calls.push({method, args: {...args}})
    const failure = failures.get(method)
    if (failure !== undefined) {
      failures.delete(method)
      throw httpError(failure.status, failure.message)
    }
  }

  const requireCommit = (sha: string): StoredCommit => {
    const commit = commits.get(sha)
    if (commit === undefined) throw httpError(404, 'Not Found')
    return commit
  }

  const requireRef = (ref: string): string => {
    const sha = refs.get(ref)
    if (sha === undefined) throw httpError(404, 'Not Found')
    return sha
  }

  const refName = (ref: string): string => (ref.startsWith('heads/') ? ref.slice('heads/'.length) : ref)

  const ancestorsOf = (sha: string): Set<string> => {
    const seen = new Set<string>()
    const queue = [sha]
    while (queue.length > 0) {
      const next = queue.pop() ?? ''
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(...requireCommit(next).parents)
    }
    return seen
  }

  const isAncestor = (ancestor: string, descendant: string): boolean => ancestorsOf(descendant).has(ancestor)

  /** A best common ancestor: a common ancestor that is not an ancestor of another one. */
  const mergeBase = (left: string, right: string): string => {
    const leftSet = ancestorsOf(left)
    const common = [...ancestorsOf(right)].filter(sha => leftSet.has(sha))
    const best = common.find(candidate => common.every(other => other === candidate || !isAncestor(candidate, other)))
    if (best === undefined) throw httpError(404, 'Not Found')
    return best
  }

  const resolveCommitish = (name: string): string => refs.get(name) ?? (commits.has(name) ? name : requireRef(name))

  const entriesAt = (commitSha: string): FakeTreeEntry[] =>
    [...(trees.get(requireCommit(commitSha).tree) ?? EMPTY_TREE).values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    )

  const filesAt = (commitSha: string): Record<string, string> => {
    const files: Record<string, string> = {}
    for (const entry of entriesAt(commitSha)) files[entry.path] = blobs.get(entry.sha) ?? ''
    return files
  }

  const commitOn = (
    ref: string,
    changes: Readonly<Record<string, FileChange>>,
    commitOptions: CommitOptions,
  ): string => {
    const parent = requireRef(ref)
    const next = new Map<string, FakeTreeEntry>(entriesAt(parent).map(entry => [entry.path, entry]))
    for (const [path, change] of Object.entries(changes)) {
      if (change === null) next.delete(path)
      else next.set(path, entryFor(path, change))
    }
    const sha = storeCommit({
      tree: storeTree(next),
      parents: [parent],
      message: commitOptions.message ?? 'concurrent change',
      authorLogin: commitOptions.authorLogin ?? defaultAuthor,
    })
    refs.set(ref, sha)
    return sha
  }

  const client: FakeClient = {
    rest: {
      repos: {
        getBranch: async params => {
          record('getBranch', params)
          const sha = requireRef(params.branch)
          const commit = requireCommit(sha)
          return {
            data: {
              name: params.branch,
              protected: options.protectedBranch ?? false,
              commit: {sha, author: {login: commit.authorLogin}},
            },
          }
        },
        compareCommitsWithBasehead: async params => {
          record('compareCommitsWithBasehead', params)
          const [baseName = '', headName = ''] = params.basehead.split('...')
          const base = resolveCommitish(baseName)
          const head = resolveCommitish(headName)
          const baseAncestors = ancestorsOf(base)
          const headAncestors = ancestorsOf(head)
          return {
            data: {
              merge_base_commit: {sha: mergeBase(base, head)},
              ahead_by: [...headAncestors].filter(sha => !baseAncestors.has(sha)).length,
              behind_by: [...baseAncestors].filter(sha => !headAncestors.has(sha)).length,
            },
          }
        },
      },
      git: {
        getRef: async params => {
          record('getRef', params)
          return {data: {object: {sha: requireRef(refName(params.ref))}}}
        },
        getCommit: async params => {
          record('getCommit', params)
          return {data: {sha: params.commit_sha, tree: {sha: requireCommit(params.commit_sha).tree}}}
        },
        getTree: async params => {
          record('getTree', params)
          const tree = trees.get(params.tree_sha)
          if (tree === undefined) throw httpError(404, 'Not Found')
          const all = [...tree.values()].sort((left, right) => left.path.localeCompare(right.path))
          // Like the real API: without `recursive` only direct children come back, with nested
          // directories as `tree` entries; with it, every file plus every directory above it. A
          // reader that forgets `recursive` goes blind, and one that forgets to skip `tree` entries
          // sees directories as files.
          const entries =
            params.recursive === 'true'
              ? withDirectories(all).sort((left, right) => left.path.localeCompare(right.path))
              : directChildren(all)
          const visible = truncated ? entries.slice(0, Math.max(1, Math.floor(entries.length / 2))) : entries
          return {data: {sha: params.tree_sha, truncated, tree: visible.map(entry => ({...entry}))}}
        },
        getBlob: async params => {
          record('getBlob', params)
          const content = blobs.get(params.file_sha)
          if (content === undefined) throw httpError(404, 'Not Found')
          return {data: {content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64'}}
        },
        createBlob: async params => {
          record('createBlob', {...params, content: `[${params.content.length} chars]`})
          return {data: {sha: storeBlob(params.content)}}
        },
        createTree: async params => {
          record('createTree', {...params, tree: params.tree})
          const base = params.base_tree === undefined ? EMPTY_TREE : trees.get(params.base_tree)
          if (base === undefined) throw httpError(422, 'Invalid base_tree')
          const next = new Map(base)
          for (const item of params.tree) {
            if (item.path === undefined) throw httpError(422, 'Invalid tree: path is required')
            if (item.sha === null) {
              if (!next.has(item.path)) throw httpError(422, 'Invalid tree: deleting a path that does not exist')
              next.delete(item.path)
              continue
            }
            const type = item.type ?? 'blob'
            // A submodule entry names a commit that lives in another repository, so it is not checked.
            if (item.sha === undefined || (type !== 'commit' && !blobs.has(item.sha))) {
              throw httpError(422, 'Invalid tree: unknown blob')
            }
            next.set(item.path, {path: item.path, mode: item.mode ?? '100644', type, sha: item.sha})
          }
          return {data: {sha: storeTree(next)}}
        },
        createCommit: async params => {
          record('createCommit', params)
          if (!trees.has(params.tree)) throw httpError(422, 'Invalid tree')
          const parents = params.parents ?? []
          for (const parent of parents) requireCommit(parent)
          return {
            data: {sha: storeCommit({tree: params.tree, parents, message: params.message, authorLogin: defaultAuthor})},
          }
        },
        createRef: async params => {
          record('createRef', params)
          requireCommit(params.sha)
          // Like the real API, a ref that is not fully qualified (`heads/data`) is a 422.
          if (!params.ref.startsWith('refs/heads/')) throw httpError(422, 'Reference is not fully qualified')
          const name = params.ref.slice('refs/heads/'.length)
          // Like the real API, creating a ref that already exists is a 422.
          if (refs.has(name)) throw httpError(422, 'Reference already exists')
          refs.set(name, params.sha)
          return {data: {ref: params.ref}}
        },
        updateRef: async params => {
          updateRefCalls += 1
          updateHooks.get(updateRefCalls)?.()
          record('updateRef', params)
          const name = refName(params.ref)
          const current = requireRef(name)
          requireCommit(params.sha)
          // A non-fast-forward update is rejected, exactly like GitHub does for an unforced one.
          // The client type admits only `force: false`, so there is no forced path to model.
          if (!isAncestor(current, params.sha)) {
            throw httpError(422, 'Update is not a fast forward')
          }
          refs.set(name, params.sha)
          return {data: {object: {sha: params.sha}}}
        },
      },
    },
  }

  return {
    client,
    calls,
    files: (ref = branch) => filesAt(requireRef(ref)),
    entries: (ref = branch) => entriesAt(requireRef(ref)),
    head: (ref = branch) => requireRef(ref),
    hasBranch: ref => refs.has(ref),
    createBranch: (name, from = branch) => {
      const sha = requireRef(from)
      refs.set(name, sha)
      return sha
    },
    deleteBranch: name => {
      refs.delete(name)
    },
    commit: (ref, changes, commitOptions = {}) => commitOn(ref, changes, commitOptions),
    commitCount: () => commits.size,
    parentsOf: sha => requireCommit(sha).parents,
    messageOf: sha => requireCommit(sha).message,
    truncate: on => {
      truncated = on
    },
    advance: (changes, advanceOptions = {}) => commitOn(branch, changes, advanceOptions),
    beforeUpdateRef: (attempt, hook) => {
      updateHooks.set(attempt, hook)
    },
    failNext: (method, status, message = `HTTP ${status}`) => {
      failures.set(method, {status, message})
    },
  }
}
