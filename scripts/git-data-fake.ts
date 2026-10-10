/**
 * An in-memory Git Data API for tests: a blob/tree/commit store behind the same call shapes the
 * rename writer uses, with a real fast-forward check on `updateRef`.
 *
 * It exists so the writer is exercised against git's actual rules (a non-fast-forward update is a
 * 422, a stale `base_tree` is not silently merged) rather than against canned responses. Test
 * support only: no production module imports it.
 */

import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'

export interface FakeTreeEntry {
  readonly path: string
  readonly mode: string
  readonly type: string
  readonly sha: string
}

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
  readonly files?: Readonly<Record<string, string>>
  readonly branch?: string
  /** Login recorded as the author of the seed commit and of `advance()` commits by default. */
  readonly authorLogin?: string
  readonly protectedBranch?: boolean
}

export interface GitDataFake {
  /** Structurally compatible with the rename writer's client type. */
  readonly client: FakeClient
  /** Every API call, in order. */
  readonly calls: readonly FakeCall[]
  /** Current content of every file on the branch. */
  files: () => Record<string, string>
  head: () => string
  commitCount: () => number
  parentsOf: (sha: string) => readonly string[]
  messageOf: (sha: string) => string
  /** Make `getTree` report `truncated: true` and return only part of the tree. */
  truncate: (on: boolean) => void
  /** Move the branch forward with a commit made by someone else (a concurrent writer). */
  advance: (
    files: Readonly<Record<string, string | null>>,
    options?: {message?: string; authorLogin?: string},
  ) => string
  /** Run `hook` immediately before the n-th (1-based) `updateRef`, e.g. to `advance()` the branch. */
  beforeUpdateRef: (attempt: number, hook: () => void) => void
  /** Fail the next call to `method` with an HTTP-style error. */
  failNext: (method: string, status: number, message?: string) => void
}

export interface FakeClient {
  rest: {
    repos: {
      getBranch: (params: {owner: string; repo: string; branch: string}) => Promise<{
        data: {
          protected?: boolean
          protection?: {enabled?: boolean}
          commit: {sha: string; author?: {login?: string} | null}
        }
      }>
    }
    git: {
      getRef: (params: {owner: string; repo: string; ref: string}) => Promise<{data: {object: {sha: string}}}>
      getCommit: (params: {owner: string; repo: string; commit_sha: string}) => Promise<{
        data: {sha: string; tree: {sha: string}}
      }>
      getTree: (params: {owner: string; repo: string; tree_sha: string; recursive?: string}) => Promise<{
        data: {sha: string; truncated: boolean; tree: {path?: string; mode?: string; type?: string; sha?: string}[]}
      }>
      getBlob: (params: {owner: string; repo: string; file_sha: string}) => Promise<{
        data: {content: string; encoding: string}
      }>
      createBlob: (params: {
        owner: string
        repo: string
        content: string
        encoding?: string
      }) => Promise<{data: {sha: string}}>
      createTree: (params: {
        owner: string
        repo: string
        base_tree?: string
        tree: {path?: string; mode?: string; type?: string; sha?: string | null}[]
      }) => Promise<{data: {sha: string}}>
      createCommit: (params: {
        owner: string
        repo: string
        message: string
        tree: string
        parents?: string[]
      }) => Promise<{data: {sha: string}}>
      updateRef: (params: {
        owner: string
        repo: string
        ref: string
        sha: string
        force?: boolean
      }) => Promise<{data: {object: {sha: string}}}>
    }
  }
}

const EMPTY_TREE = new Map<string, FakeTreeEntry>()

function sha1(...parts: string[]): string {
  const hash = createHash('sha1')
  for (const part of parts) hash.update(`${part.length}:${part}`)
  return hash.digest('hex')
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
    const sha = sha1('tree', ...[...entries.values()].map(entry => `${entry.path}\0${entry.sha}`).sort())
    trees.set(sha, entries)
    return sha
  }

  const storeCommit = (commit: StoredCommit): string => {
    counter += 1
    const sha = sha1('commit', commit.tree, ...commit.parents, commit.message, String(counter))
    commits.set(sha, commit)
    return sha
  }

  const treeFromFiles = (files: Readonly<Record<string, string>>): string => {
    const entries = new Map<string, FakeTreeEntry>()
    for (const [path, content] of Object.entries(files)) {
      entries.set(path, {path, mode: '100644', type: 'blob', sha: storeBlob(content)})
    }
    return storeTree(entries)
  }

  let headSha = storeCommit({
    tree: treeFromFiles(options.files ?? {}),
    parents: [],
    message: 'seed',
    authorLogin: defaultAuthor,
  })

  const record = (method: string, args: Record<string, unknown>): void => {
    calls.push({method, args})
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

  const isAncestor = (ancestor: string, descendant: string): boolean => {
    const seen = new Set<string>()
    const queue = [descendant]
    while (queue.length > 0) {
      const sha = queue.pop() ?? ''
      if (sha === ancestor) return true
      if (seen.has(sha)) continue
      seen.add(sha)
      queue.push(...(commits.get(sha)?.parents ?? []))
    }
    return false
  }

  const filesAt = (commitSha: string): Record<string, string> => {
    const files: Record<string, string> = {}
    for (const entry of (trees.get(requireCommit(commitSha).tree) ?? EMPTY_TREE).values()) {
      files[entry.path] = blobs.get(entry.sha) ?? ''
    }
    return files
  }

  const client: FakeClient = {
    rest: {
      repos: {
        getBranch: async params => {
          record('getBranch', params)
          const commit = requireCommit(headSha)
          return {
            data: {
              protected: options.protectedBranch ?? false,
              commit: {sha: headSha, author: {login: commit.authorLogin}},
            },
          }
        },
      },
      git: {
        getRef: async params => {
          record('getRef', params)
          if (params.ref !== `heads/${branch}`) throw httpError(404, 'Not Found')
          return {data: {object: {sha: headSha}}}
        },
        getCommit: async params => {
          record('getCommit', params)
          return {data: {sha: params.commit_sha, tree: {sha: requireCommit(params.commit_sha).tree}}}
        },
        getTree: async params => {
          record('getTree', params)
          const tree = trees.get(params.tree_sha)
          if (tree === undefined) throw httpError(404, 'Not Found')
          const entries = [...tree.values()].sort((left, right) => left.path.localeCompare(right.path))
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
            if (item.sha === undefined || !blobs.has(item.sha)) throw httpError(422, 'Invalid tree: unknown blob')
            next.set(item.path, {
              path: item.path,
              mode: item.mode ?? '100644',
              type: item.type ?? 'blob',
              sha: item.sha,
            })
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
        updateRef: async params => {
          updateRefCalls += 1
          updateHooks.get(updateRefCalls)?.()
          record('updateRef', params)
          if (params.ref !== `heads/${branch}`) throw httpError(404, 'Not Found')
          requireCommit(params.sha)
          // A non-fast-forward update is rejected unless forced, exactly like GitHub.
          if (params.force !== true && !isAncestor(headSha, params.sha)) {
            throw httpError(422, 'Update is not a fast forward')
          }
          headSha = params.sha
          return {data: {object: {sha: headSha}}}
        },
      },
    },
  }

  return {
    client,
    calls,
    files: () => filesAt(headSha),
    head: () => headSha,
    commitCount: () => commits.size,
    parentsOf: sha => requireCommit(sha).parents,
    messageOf: sha => requireCommit(sha).message,
    truncate: on => {
      truncated = on
    },
    advance: (changes, advanceOptions = {}) => {
      const next = {...filesAt(headSha)}
      for (const [path, content] of Object.entries(changes)) {
        if (content === null) delete next[path]
        else next[path] = content
      }
      headSha = storeCommit({
        tree: treeFromFiles(next),
        parents: [headSha],
        message: advanceOptions.message ?? 'concurrent change',
        authorLogin: advanceOptions.authorLogin ?? defaultAuthor,
      })
      return headSha
    },
    beforeUpdateRef: (attempt, hook) => {
      updateHooks.set(attempt, hook)
    },
    failNext: (method, status, message = `HTTP ${status}`) => {
      failures.set(method, {status, message})
    },
  }
}
