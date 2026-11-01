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

export interface FakeGithub {
  /** The directory the child reads its routes from and writes `calls.log` to. */
  readonly directory: string
  /** Arguments to the runtime before the script path: `bun --preload` and `node --import` differ. */
  readonly runtimeArgs: (runtime: 'bun' | 'node') => string[]
  /** Replaces the routes; call before the run. */
  readonly setRoutes: (routes: readonly FakeRoute[]) => void
  /** Every request the child made, in order. */
  readonly calls: () => string[]
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

export function createFakeGithub(routes: readonly FakeRoute[] = []): FakeGithub {
  const directory = mkdtempSync(join(tmpdir(), 'fake-github-'))
  const setRoutes = (next: readonly FakeRoute[]) => {
    writeFileSync(join(directory, 'routes.json'), JSON.stringify(next))
  }
  setRoutes(routes)
  return {
    directory,
    runtimeArgs: runtime =>
      runtime === 'bun'
        ? ['--no-install', '--no-env-file', '--preload', fakeGithubPreloadPath]
        : ['--import', fakeGithubPreloadPath],
    setRoutes,
    calls: () => {
      try {
        return readFileSync(join(directory, 'calls.log'), 'utf8').split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
    cleanup: () => {
      rmSync(directory, {recursive: true, force: true})
    },
  }
}
