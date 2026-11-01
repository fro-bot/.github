/**
 * A fake GitHub API for a CLI run in a child process. `createFakeGithub` makes a temp directory, writes
 * the routes the run may call, and gives `runtimeArgs` that preload `fixtures/fake-github-preload.mjs`,
 * which replaces `fetch` inside the child: Octokit then talks to the routes, never the network. After
 * the run, `calls()` lists every request the child made as `METHOD /path?query auth=<token> body=<json>`;
 * a request no route matched appears as `UNHANDLED ...` and was answered 404.
 *
 * Use it with `spawnEntrypoint({runtimeArgs, env: {FAKE_GH_DIR: fake.directory}})`.
 */

import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

export interface FakeAnswer {
  /** HTTP status. Default 200. */
  readonly s?: number
  /** JSON body. Omitted for a 204. */
  readonly b?: unknown
  /** Extra response headers. */
  readonly h?: Readonly<Record<string, string>>
}

export interface FakeRoute extends FakeAnswer {
  readonly m: string
  /** The exact pathname, or `~<regex>` tested against it. */
  readonly p: string
  /** A substring the query string must contain. */
  readonly q?: string
  /** Each match answers with the next entry; the last repeats. */
  readonly seq?: readonly FakeAnswer[]
}

/** One request the child made. `line` is the log line without the `UNHANDLED ` marker. */
export interface FakeRequest {
  readonly method: string
  /** The path and query, as logged. */
  readonly target: string
  /** False when no route matched and the fake answered 404. */
  readonly handled: boolean
  readonly line: string
}

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface FakeGithub {
  /** The directory the child reads its routes from and writes `calls.log` to. */
  readonly directory: string
  /** Arguments to the runtime before the script path: `bun --preload` and `node --import` differ. */
  readonly runtimeArgs: (runtime: 'bun' | 'node') => string[]
  /** Replaces the routes; call before the run. */
  readonly setRoutes: (routes: readonly FakeRoute[]) => void
  /** Every request the child made, in order, as logged: an unmatched one carries an `UNHANDLED ` prefix. */
  readonly calls: () => string[]
  /** The same requests, parsed. Matched and unmatched requests are both here, so a count cannot miss one. */
  readonly requests: () => FakeRequest[]
  /** The unmatched POST, PUT, PATCH and DELETE requests: a write the run attempted that no route allowed. */
  readonly unhandledMutations: () => FakeRequest[]
  readonly cleanup: () => void
}

export const fakeGithubPreloadPath: string = fileURLToPath(
  new URL('../fixtures/fake-github-preload.mjs', import.meta.url),
)

/** A route that answers `m path` with status `s` (default 200) and body `b`. */
export function route(
  m: string,
  p: string,
  answer: FakeAnswer & {q?: string; seq?: readonly FakeAnswer[]} = {},
): FakeRoute {
  return {m, p, ...answer}
}

/** Parses one `calls.log` line. */
export function parseCall(line: string): FakeRequest {
  const handled = !line.startsWith('UNHANDLED ')
  const text = handled ? line : line.slice('UNHANDLED '.length)
  const [method = '', target = ''] = text.split(' ')
  return {method, target, handled, line: text}
}

export function createFakeGithub(routes: readonly FakeRoute[] = []): FakeGithub {
  const directory = mkdtempSync(join(tmpdir(), 'fake-github-'))
  const setRoutes = (next: readonly FakeRoute[]) => {
    writeFileSync(join(directory, 'routes.json'), JSON.stringify(next))
  }
  setRoutes(routes)
  const calls = () => {
    try {
      return readFileSync(join(directory, 'calls.log'), 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
  const requests = () => calls().map(parseCall)
  return {
    directory,
    runtimeArgs: runtime =>
      runtime === 'bun'
        ? ['--no-install', '--no-env-file', '--preload', fakeGithubPreloadPath]
        : ['--import', fakeGithubPreloadPath],
    setRoutes,
    calls,
    requests,
    unhandledMutations: () => requests().filter(request => !request.handled && MUTATING_METHODS.has(request.method)),
    cleanup: () => {
      rmSync(directory, {recursive: true, force: true})
    },
  }
}
