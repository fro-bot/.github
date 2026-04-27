import process from 'node:process'

import {Agent, CredentialSession, RichText} from '@atproto/api'

const BLUESKY_SERVICE = 'https://bsky.social'
const MAX_GRAPHEMES = 300
const TRUNCATION_SUFFIX = '...'
const TRUNCATION_LIMIT = MAX_GRAPHEMES - TRUNCATION_SUFFIX.length

export interface BlueSkyPostParams {
  /** Post text. Truncated to 300 graphemes if longer. */
  text: string
  /** Optional explicit `createdAt` timestamp. Defaults to `new Date().toISOString()`. */
  createdAt?: string
  /** Override BlueSky handle. Defaults to `BLUESKY_HANDLE` env var. */
  handle?: string
  /** Override app password. Defaults to `BLUESKY_APP_PASSWORD` env var. */
  appPassword?: string
  /** Override the service URL (for testing). Defaults to `https://bsky.social`. */
  serviceUrl?: string
}

export interface BlueSkyPostResult {
  posted: boolean
  uri?: string
  skipped?: string
}

function truncateToGraphemes(text: string, limit: number): string {
  const segmenter = new Intl.Segmenter()
  const segments = [...segmenter.segment(text)]
  if (segments.length <= limit) return text
  return segments
    .slice(0, limit)
    .map(s => s.segment)
    .join('')
}

/**
 * Post plain text to BlueSky via the AT Protocol.
 *
 * Returns `{posted: false, skipped}` immediately when credentials are absent
 * so callers do not need to guard against missing env vars.
 */
export async function postToBluesky(params: BlueSkyPostParams): Promise<BlueSkyPostResult> {
  const handle = params.handle ?? process.env.BLUESKY_HANDLE
  const appPassword = params.appPassword ?? process.env.BLUESKY_APP_PASSWORD

  if (handle === undefined || handle === '' || appPassword === undefined || appPassword === '') {
    return {
      posted: false,
      skipped: 'BLUESKY_HANDLE or BLUESKY_APP_PASSWORD not set — skipping BlueSky post',
    }
  }

  const serviceUrl = params.serviceUrl ?? BLUESKY_SERVICE

  // Truncate if needed before building RichText so facet detection runs on final text.
  const rawText = new RichText({text: params.text})
  const finalText =
    rawText.graphemeLength > MAX_GRAPHEMES
      ? truncateToGraphemes(params.text, TRUNCATION_LIMIT) + TRUNCATION_SUFFIX
      : params.text

  const rt = new RichText({text: finalText})

  const session = new CredentialSession(new URL(serviceUrl))
  await session.login({identifier: handle, password: appPassword})
  const agent = new Agent(session)

  // Detect facets resolves mention DIDs and linkifies URLs.
  await rt.detectFacets(agent)

  const result = await agent.post({
    text: rt.text,
    facets: rt.facets,
    createdAt: params.createdAt ?? new Date().toISOString(),
  })

  return {posted: true, uri: result.uri}
}

async function main(): Promise<void> {
  const text = process.argv[2]
  if (text === undefined || text === '') {
    process.stderr.write('Usage: bluesky-post.ts <text>\n')
    process.exit(1)
  }
  const result = await postToBluesky({text})
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
