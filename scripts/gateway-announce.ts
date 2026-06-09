import {createHmac} from 'node:crypto'
import process from 'node:process'

export type EventType = 'survey_completed' | 'invitation_accepted' | 'daily_digest'

const VALID_EVENT_TYPES = new Set<string>(['survey_completed', 'invitation_accepted', 'daily_digest'])

export function isEventType(value: string): value is EventType {
  return VALID_EVENT_TYPES.has(value)
}

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
  /** Per-attempt fetch timeout in ms. Defaults to 10000. */
  timeoutMs?: number
}

export type AnnounceResult =
  | {posted: true; status: number}
  | {posted: false; skipped: 'kill-switch' | 'missing-config'}
  | {posted: false; failure: 'http'; status: number}
  | {posted: false; failure: 'network'}
  | {posted: false; failure: 'missing-event-type'}
  | {posted: false; failure: 'invalid-event-type'}
  | {posted: false; failure: 'missing-context'}
  | {posted: false; failure: 'malformed-context'}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex')
}

function isKillSwitchActive(raw: string | undefined): boolean {
  const ks = (raw ?? '').trim().toLowerCase()
  return ks !== '' && ks !== 'false' && ks !== '0'
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
  const killSwitchRaw = params.killSwitch ?? process.env.GATEWAY_ANNOUNCE_DISABLED
  if (isKillSwitchActive(killSwitchRaw)) {
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
  const timeoutMs = params.timeoutMs ?? 10_000

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

  const doPost = async (): Promise<Response> =>
    fetchImpl(url, {method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs)})

  let res: Response
  try {
    res = await doPost()
  } catch {
    // Network error or timeout on first attempt — retry once.
    await sleep(5000)
    try {
      res = await doPost()
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      // Redact: log only event type + error class, never secret/sig/body/context.repos.
      process.stderr.write(
        `gateway-announce: event_type=${params.eventType} error=network-error detail=${errMsg.slice(0, 80)}\n`,
      )
      return {posted: false, failure: 'network'}
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
      return {posted: false, failure: 'network'}
    }

    if (retryRes.status >= 200 && retryRes.status < 300) {
      return {posted: true, status: retryRes.status}
    }

    // Redact: log only event type + coarse status, never secret/sig/body/context.repos.
    process.stderr.write(`gateway-announce: event_type=${params.eventType} status=${retryRes.status} posted=false\n`)
    return {posted: false, failure: 'http', status: retryRes.status}
  }

  // 4xx — terminal, no retry.
  process.stderr.write(`gateway-announce: event_type=${params.eventType} status=${res.status} posted=false\n`)
  return {posted: false, failure: 'http', status: res.status}
}

/**
 * Parse-and-dispatch logic for the CLI entrypoint. Reads from the provided env
 * map; does NOT call process.exit or read process.env directly.
 *
 * Kill-switch is checked first — short-circuits even when EVENT_TYPE /
 * EVENT_CONTEXT_JSON are absent. Writes structured diagnostics to stderr
 * (redaction unchanged: event type class + coarse status only).
 */
export async function runCli(
  env: Record<string, string | undefined>,
  deps?: {announceImpl?: typeof announce},
): Promise<AnnounceResult> {
  const announceImpl = deps?.announceImpl ?? announce

  // Kill-switch check before any parsing — mutes cleanly even if env vars are missing.
  if (isKillSwitchActive(env.GATEWAY_ANNOUNCE_DISABLED)) {
    process.stderr.write('gateway-announce: kill switch active; skipping POST\n')
    return {posted: false, skipped: 'kill-switch'}
  }

  const eventType = env.EVENT_TYPE

  if (eventType === undefined || eventType === '') {
    process.stderr.write('gateway-announce: EVENT_TYPE not set\n')
    return {posted: false, failure: 'missing-event-type'}
  }

  if (!isEventType(eventType)) {
    process.stderr.write(`gateway-announce: EVENT_TYPE is not a valid event type class\n`)
    return {posted: false, failure: 'invalid-event-type'}
  }

  const contextJson = env.EVENT_CONTEXT_JSON

  if (contextJson === undefined || contextJson === '') {
    process.stderr.write('gateway-announce: EVENT_CONTEXT_JSON not set\n')
    return {posted: false, failure: 'missing-context'}
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
    return {posted: false, failure: 'malformed-context'}
  }

  return announceImpl({
    eventType,
    context,
  })
}

async function main(): Promise<void> {
  const result = await runCli(process.env)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
