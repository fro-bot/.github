import {createHmac} from 'node:crypto'
import process from 'node:process'

export type EventType = 'survey_completed' | 'invitation_accepted'

export interface AnnounceParams {
  eventType: EventType
  context: Record<string, unknown>
  /** Override the current timestamp. Defaults to `() => new Date().toISOString()`. */
  now?: () => string
  /** Override the HMAC secret. Defaults to `process.env.GATEWAY_WEBHOOK_SECRET`. */
  secret?: string
  /** Override the gateway URL. Defaults to `process.env.GATEWAY_PRESENCE_URL`. */
  url?: string
  /** Override the kill-switch value. Defaults to `process.env.GATEWAY_ANNOUNCE_DISABLED`. */
  killSwitch?: string
  /** Override the fetch implementation. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof globalThis.fetch
  /** Override the sleep implementation. Defaults to a real 5s sleep. */
  sleep?: (ms: number) => Promise<void>
}

export type AnnounceResult =
  | {posted: true; status: number}
  | {posted: false; skipped: 'kill-switch' | 'missing-config'}
  | {posted: false; status?: number; error?: string}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

/**
 * POST an HMAC-signed event payload to the gateway presence endpoint.
 *
 * Signs the exact bytes sent (no canonicalization). The `fired_at` field in
 * the body is byte-identical to the `X-Gateway-Timestamp` header — both are
 * driven from a single timestamp string captured before serialization.
 *
 * Returns a discriminated result; never throws. The CLI maps any result to
 * exit 0 so announce failures never fail a workflow.
 */
export async function announce(params: AnnounceParams): Promise<AnnounceResult> {
  const killSwitch = params.killSwitch ?? process.env.GATEWAY_ANNOUNCE_DISABLED
  if (killSwitch !== undefined && killSwitch !== '' && killSwitch !== 'false' && killSwitch !== '0') {
    process.stderr.write('gateway-announce: kill switch active; skipping POST\n')
    return {posted: false, skipped: 'kill-switch'}
  }

  const secret = params.secret ?? process.env.GATEWAY_WEBHOOK_SECRET
  const url = params.url ?? process.env.GATEWAY_PRESENCE_URL

  if (secret === undefined || secret === '' || url === undefined || url === '') {
    process.stderr.write(
      `gateway-announce: missing config (${secret === undefined || secret === '' ? 'GATEWAY_WEBHOOK_SECRET' : 'GATEWAY_PRESENCE_URL'} not set); skipping POST\n`,
    )
    return {posted: false, skipped: 'missing-config'}
  }

  const getNow = params.now ?? (() => new Date().toISOString())
  const fetchImpl = params.fetchImpl ?? globalThis.fetch
  const sleep = params.sleep ?? defaultSleep

  // Capture timestamp ONCE — drives both fired_at and X-Gateway-Timestamp header.
  const ts = getNow()

  const payload = {
    v: 1,
    event_type: params.eventType,
    fired_at: ts,
    context: params.context,
    rendered_text: null,
  }

  // Serialize ONCE — sign these exact bytes, send these exact bytes.
  const body = JSON.stringify(payload)

  // HMAC-SHA256(secret, "<timestamp>.<body>") — matches gateway hmac.ts formula.
  const sig = hmacSha256Hex(secret, `${ts}.${body}`)

  const headers = {
    'Content-Type': 'application/json',
    'X-Gateway-Signature': sig,
    'X-Gateway-Timestamp': ts,
  }

  const doPost = async (): Promise<Response> => fetchImpl(url, {method: 'POST', headers, body})

  let res: Response
  try {
    res = await doPost()
  } catch {
    // Network error on first attempt — retry once.
    await sleep(5000)
    try {
      res = await doPost()
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      // Redact: log only event type + error class, never secret/sig/body/context.repos.
      process.stderr.write(
        `gateway-announce: event_type=${params.eventType} error=network-error detail=${errMsg.slice(0, 80)}\n`,
      )
      return {posted: false, error: 'network-error'}
    }
  }

  if (res.status >= 200 && res.status < 300) {
    return {posted: true, status: res.status}
  }

  // 5xx (including 503) — retry once.
  if (res.status >= 500) {
    const firstStatus = res.status
    await sleep(5000)
    let retryRes: Response
    try {
      retryRes = await doPost()
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      process.stderr.write(
        `gateway-announce: event_type=${params.eventType} status=${firstStatus} retry=network-error detail=${errMsg.slice(0, 80)}\n`,
      )
      return {posted: false, status: firstStatus, error: 'network-error'}
    }

    if (retryRes.status >= 200 && retryRes.status < 300) {
      return {posted: true, status: retryRes.status}
    }

    // Redact: log only event type + coarse status, never secret/sig/body/context.repos.
    process.stderr.write(`gateway-announce: event_type=${params.eventType} status=${retryRes.status} posted=false\n`)
    return {posted: false, status: retryRes.status}
  }

  // 4xx — terminal, no retry.
  process.stderr.write(`gateway-announce: event_type=${params.eventType} status=${res.status} posted=false\n`)
  return {posted: false, status: res.status}
}

async function main(): Promise<void> {
  const eventType = process.env.EVENT_TYPE
  const contextJson = process.env.EVENT_CONTEXT_JSON

  if (eventType === undefined || eventType === '') {
    process.stderr.write('gateway-announce: EVENT_TYPE not set\n')
    process.stdout.write(`${JSON.stringify({posted: false, error: 'missing-event-type'})}\n`)
    process.exit(0)
  }

  if (contextJson === undefined || contextJson === '') {
    process.stderr.write('gateway-announce: EVENT_CONTEXT_JSON not set\n')
    process.stdout.write(`${JSON.stringify({posted: false, error: 'missing-context'})}\n`)
    process.exit(0)
  }

  let context: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(contextJson)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('context must be a JSON object')
    }
    context = parsed as Record<string, unknown>
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`gateway-announce: malformed EVENT_CONTEXT_JSON: ${detail}\n`)
    process.stdout.write(`${JSON.stringify({posted: false, error: 'malformed-context'})}\n`)
    process.exit(0)
  }

  const result = await announce({
    eventType: eventType as EventType,
    context,
  })

  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
