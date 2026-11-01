// Preload that replaces globalThis.fetch with a deterministic fake GitHub API, for a CLI run in a child
// process (`bun --preload` or `node --import`). No network is used: an unmatched request is logged as
// UNHANDLED and answered 404, and a request to any host but api.github.com throws.
//
// Routes come from $FAKE_GH_DIR/routes.json: [{m, p, q?, s, b?, h?, seq?}]. `p` is the exact pathname,
// or "~<regex>" tested against the pathname. `q` is a substring the query string must contain. `seq` is
// a list of {s, b, h}: each match answers with the next entry and the last repeats. Each request is
// appended to $FAKE_GH_DIR/calls.log as `METHOD /path?query auth=<token> body=<canonical json>`.
import {Buffer} from 'node:buffer'
import {appendFileSync, existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import process from 'node:process'

const directory = process.env.FAKE_GH_DIR
if (directory === undefined || directory === '') throw new Error('FAKE_GH_DIR is required')
const routesPath = join(directory, 'routes.json')
const routes = existsSync(routesPath) ? JSON.parse(readFileSync(routesPath, 'utf8')) : []
const used = new Map()
const logPath = join(directory, 'calls.log')

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])]),
    )
  }
  return value
}

function decodeBody(text) {
  if (text === '') return ''
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return ` body=${JSON.stringify(text)}`
  }
  // A contents write carries base64: log the decoded text, which is what a reader can compare.
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof parsed.content === 'string' &&
    typeof parsed.message === 'string'
  ) {
    parsed = {...parsed, content: '<b64>', content_decoded: Buffer.from(parsed.content, 'base64').toString('utf8')}
  }
  return ` body=${JSON.stringify(canonical(parsed))}`
}

function matches(route, method, pathname, url) {
  if (route.m !== method) return false
  const hit = route.p.startsWith('~') ? new RegExp(route.p.slice(1), 'u').test(pathname) : route.p === pathname
  if (!hit) return false
  return route.q === undefined || url.search.includes(route.q)
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const pathname = decodeURIComponent(url.pathname)
  if (url.host !== 'api.github.com') throw new Error(`fake-github: blocked request to ${url.host}`)
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers ?? {})
  const auth = (headers.get('authorization') ?? '').replace(/^(token|bearer) /iu, '')
  const query = [...url.searchParams.entries()]
    .filter(([key]) => key !== 'per_page' && key !== 'page')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('&')
  const body = typeof init.body === 'string' ? init.body : ''
  const line = `${method} ${pathname}${query === '' ? '' : `?${query}`} auth=${auth === '' ? '-' : auth}${decodeBody(body)}`

  const index = routes.findIndex(route => matches(route, method, pathname, url))
  if (index === -1) {
    appendFileSync(logPath, `UNHANDLED ${line}\n`)
    return new Response(JSON.stringify({message: 'Not Found'}), {
      status: 404,
      headers: {'content-type': 'application/json'},
    })
  }
  appendFileSync(logPath, `${line}\n`)
  const route = routes[index]
  const count = used.get(index) ?? 0
  used.set(index, count + 1)
  const answer = route.seq === undefined ? route : route.seq[Math.min(count, route.seq.length - 1)]
  const status = answer.s ?? 200
  const payload = status === 204 || answer.b === undefined ? null : JSON.stringify(answer.b)
  const response = new Response(payload, {
    status,
    headers: {'content-type': 'application/json', ...answer.h},
  })
  // Octokit's paginate reads response.url to build the next-page URL.
  Object.defineProperty(response, 'url', {value: url.href})
  return response
}
