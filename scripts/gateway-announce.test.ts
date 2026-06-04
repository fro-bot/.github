import {Buffer} from 'node:buffer'
import {createHmac} from 'node:crypto'
import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const modulePromise: Promise<{
  announce: typeof import('./gateway-announce.js').announce
}> = import(`./gateway-announce${'.js'}`)
const {announce} = await modulePromise

// Helpers
const TEST_URL = 'https://gateway.example.com/v1/announce'
const TEST_SECRET = 'test-secret-value'
const TEST_TS = '2026-06-04T12:00:00.000Z'
const TEST_EVENT_TYPE = 'survey_completed' as const
const TEST_CONTEXT = {owner: 'fro-bot', repo: 'test-repo', slug: 'test-slug', wiki_pages_changed: 3}

async function noSleep(_ms: number): Promise<void> {
  return Promise.resolve()
}

function makeOkFetch(status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(new Response('ok', {status})) as unknown as typeof globalThis.fetch
}

function makeStatusFetch(...statuses: number[]): typeof globalThis.fetch {
  const mock = vi.fn()
  for (const s of statuses) {
    mock.mockResolvedValueOnce(new Response('', {status: s}))
  }
  return mock as unknown as typeof globalThis.fetch
}

// Capture stderr output during a test
async function captureStderr(fn: () => Promise<unknown>): Promise<{result: unknown; stderr: string}> {
  const chunks: string[] = []
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  })
  return fn()
    .then(result => {
      stderrSpy.mockRestore()
      return {result, stderr: chunks.join('')}
    })
    .catch(error => {
      stderrSpy.mockRestore()
      throw error
    })
}

describe('announce', () => {
  beforeEach(() => {
    // Ensure env vars are not set by default
    delete process.env.GATEWAY_WEBHOOK_SECRET
    delete process.env.GATEWAY_PRESENCE_URL
    delete process.env.GATEWAY_ANNOUNCE_DISABLED
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Happy path ───────────────────────────────────────────────────────────

  it('happy path: POSTs to correct URL with all 3 required headers and returns posted:true', async () => {
    const fetchImpl = makeOkFetch(200)

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    expect(result).toEqual({posted: true, status: 200})
    expect(fetchImpl).toHaveBeenCalledOnce()

    const [calledUrl, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(TEST_URL)
    expect(init.method).toBe('POST')

    const reqHeaders = init.headers as Record<string, string>
    expect(reqHeaders['Content-Type']).toBe('application/json')
    expect(reqHeaders['X-Gateway-Timestamp']).toBe(TEST_TS)
    expect(typeof reqHeaders['X-Gateway-Signature']).toBe('string')
    expect(reqHeaders['X-Gateway-Signature']).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(reqHeaders['X-Gateway-Signature'] ?? '')).toBe(true)
  })

  // ─── HMAC vector ─────────────────────────────────────────────────────────

  it('HMAC vector: signature equals createHmac(sha256,secret).update(ts).update(".").update(body).digest(hex)', async () => {
    const fetchImpl = makeOkFetch(200)

    await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const sentBody = init.body as string
    const sentSig = (init.headers as Record<string, string>)['X-Gateway-Signature']

    // Compute expected signature independently — matches gateway hmac.ts formula exactly.
    const expectedSig = createHmac('sha256', TEST_SECRET).update(TEST_TS).update('.').update(sentBody).digest('hex')

    expect(sentSig).toBe(expectedSig)
  })

  // ─── fired_at ↔ header byte-equality ─────────────────────────────────────

  it('fired_at in posted body byte-equals the X-Gateway-Timestamp header', async () => {
    const fetchImpl = makeOkFetch(200)

    await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>
    const tsHeader = (init.headers as Record<string, string>)['X-Gateway-Timestamp']

    expect(sentBody.fired_at).toBe(tsHeader)
    expect(sentBody.fired_at).toBe(TEST_TS)
  })

  // ─── Payload shape ────────────────────────────────────────────────────────

  it('payload shape: v===1, rendered_text key present and null, context passed verbatim', async () => {
    const fetchImpl = makeOkFetch(200)
    const ctx = {owner: 'acme', repo: 'widget', slug: 'acme-widget', wiki_pages_changed: 7}

    await announce({
      eventType: 'invitation_accepted',
      context: ctx,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>

    expect(body.v).toBe(1)
    expect(body.event_type).toBe('invitation_accepted')
    expect(Object.prototype.hasOwnProperty.call(body, 'rendered_text')).toBe(true)
    expect(body.rendered_text).toBeNull()
    expect(body.context).toEqual(ctx)
  })

  // ─── 503 then 200 → one retry ─────────────────────────────────────────────

  it('503 then 200: retries once, sleep called exactly once, returns posted:true', async () => {
    const fetchImpl = makeStatusFetch(503, 200)
    const sleepSpy = vi.fn(noSleep)

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: sleepSpy,
    })

    expect(result).toEqual({posted: true, status: 200})
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepSpy).toHaveBeenCalledOnce()
    expect(sleepSpy).toHaveBeenCalledWith(5000)
  })

  // ─── Two consecutive 5xx ──────────────────────────────────────────────────

  it('two consecutive 5xx: returns posted:false, no secret or sig in stderr', async () => {
    const fetchImpl = makeStatusFetch(503, 503)
    const sleepSpy = vi.fn(noSleep)

    const {result, stderr} = await captureStderr(async () =>
      announce({
        eventType: TEST_EVENT_TYPE,
        context: TEST_CONTEXT,
        now: () => TEST_TS,
        secret: TEST_SECRET,
        url: TEST_URL,
        fetchImpl,
        sleep: sleepSpy,
      }),
    )

    expect((result as {posted: boolean}).posted).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepSpy).toHaveBeenCalledOnce()

    // Redaction: secret and signature must not appear in stderr.
    expect(stderr).not.toContain(TEST_SECRET)
    // Signature is not known here, but we can verify the secret isn't echoed.
    expect(stderr).toContain('survey_completed')
    expect(stderr).toContain('503')
  })

  // ─── Network throw twice ──────────────────────────────────────────────────

  it('network throw twice: retried once, returns posted:false with error=network-error', async () => {
    const netErr = new Error('ECONNREFUSED')
    const fetchImpl = vi.fn().mockRejectedValue(netErr) as unknown as typeof globalThis.fetch
    const sleepSpy = vi.fn(noSleep)

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: sleepSpy,
    })

    expect((result as {posted: boolean; error?: string}).posted).toBe(false)
    expect((result as {posted: boolean; error?: string}).error).toBe('network-error')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepSpy).toHaveBeenCalledOnce()
  })

  // ─── 4xx → no retry ───────────────────────────────────────────────────────

  it.each([400, 401, 429])('status %i: no retry, returns posted:false', async status => {
    const fetchImpl = makeStatusFetch(status)

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    expect((result as {posted: boolean; status?: number}).posted).toBe(false)
    expect((result as {posted: boolean; status?: number}).status).toBe(status)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  // ─── Kill switch ──────────────────────────────────────────────────────────

  it('kill switch: no fetch, no HMAC, returns skipped:kill-switch, stderr line present', async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch

    const {result, stderr} = await captureStderr(async () =>
      announce({
        eventType: TEST_EVENT_TYPE,
        context: TEST_CONTEXT,
        now: () => TEST_TS,
        secret: TEST_SECRET,
        url: TEST_URL,
        killSwitch: 'true',
        fetchImpl,
        sleep: noSleep,
      }),
    )

    expect(result).toEqual({posted: false, skipped: 'kill-switch'})
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(stderr).toContain('kill switch active')
  })

  it('kill switch via env: GATEWAY_ANNOUNCE_DISABLED=1 skips', async () => {
    process.env.GATEWAY_ANNOUNCE_DISABLED = '1'
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    expect(result).toEqual({posted: false, skipped: 'kill-switch'})
    expect(fetchImpl).not.toHaveBeenCalled()
    delete process.env.GATEWAY_ANNOUNCE_DISABLED
  })

  // ─── Missing config ───────────────────────────────────────────────────────

  it('missing secret: returns skipped:missing-config, no fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    expect(result).toEqual({posted: false, skipped: 'missing-config'})
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('missing url: returns skipped:missing-config, no fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      secret: TEST_SECRET,
      fetchImpl,
      sleep: noSleep,
    })

    expect(result).toEqual({posted: false, skipped: 'missing-config'})
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // ─── Redaction ────────────────────────────────────────────────────────────

  it('redaction: failing POST stderr/result contains event type + status but NOT secret, sig, body, or context.repos values', async () => {
    const sensitiveContext = {
      repos: [{owner: 'secret-owner', name: 'secret-repo'}],
      count: 1,
    }
    const fetchImpl = makeStatusFetch(503, 503)
    const sleepSpy = vi.fn(noSleep)

    const {result, stderr} = await captureStderr(async () =>
      announce({
        eventType: 'invitation_accepted',
        context: sensitiveContext,
        now: () => TEST_TS,
        secret: TEST_SECRET,
        url: TEST_URL,
        fetchImpl,
        sleep: sleepSpy,
      }),
    )

    // Compute what the signature would have been to verify it's not in stderr.
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const sentBody = init.body as string
    const actualSig = createHmac('sha256', TEST_SECRET).update(TEST_TS).update('.').update(sentBody).digest('hex')

    // Must contain event type and coarse status.
    expect(stderr).toContain('invitation_accepted')
    expect(stderr).toContain('503')

    // Must NOT contain auth material or sensitive context.
    expect(stderr).not.toContain(TEST_SECRET)
    expect(stderr).not.toContain(actualSig)
    expect(stderr).not.toContain(TEST_TS)
    expect(stderr).not.toContain('secret-owner')
    expect(stderr).not.toContain('secret-repo')
    expect(stderr).not.toContain(sentBody)

    // Result must not echo secret or signature.
    const resultStr = JSON.stringify(result)
    expect(resultStr).not.toContain(TEST_SECRET)
    expect(resultStr).not.toContain(actualSig)
    expect(resultStr).not.toContain('secret-owner')
    expect(resultStr).not.toContain('secret-repo')
  })

  it('redaction (success path): stdout result does not echo secret or signature', async () => {
    const fetchImpl = makeOkFetch(200)

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const sentBody = init.body as string
    const actualSig = createHmac('sha256', TEST_SECRET).update(TEST_TS).update('.').update(sentBody).digest('hex')

    const resultStr = JSON.stringify(result)
    expect(resultStr).not.toContain(TEST_SECRET)
    expect(resultStr).not.toContain(actualSig)
  })

  // ─── Signed bytes are the exact bytes sent ────────────────────────────────

  it('signed bytes are the exact bytes sent: body used for signing equals body in request', async () => {
    const fetchImpl = makeOkFetch(200)

    await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: noSleep,
    })

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const sentBody = init.body as string
    const sentSig = (init.headers as Record<string, string>)['X-Gateway-Signature']
    const sentTs = (init.headers as Record<string, string>)['X-Gateway-Timestamp'] ?? ''

    // Verify the signature against the EXACT bytes sent.
    const recomputedSig = createHmac('sha256', TEST_SECRET).update(sentTs).update('.').update(sentBody).digest('hex')

    expect(sentSig).toBe(recomputedSig)
  })

  // ─── Network throw on first, 200 on retry ─────────────────────────────────

  it('network throw on first attempt then 200 on retry: returns posted:true', async () => {
    const netErr = new Error('ETIMEDOUT')
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce(new Response('ok', {status: 200})) as unknown as typeof globalThis.fetch
    const sleepSpy = vi.fn(noSleep)

    const result = await announce({
      eventType: TEST_EVENT_TYPE,
      context: TEST_CONTEXT,
      now: () => TEST_TS,
      secret: TEST_SECRET,
      url: TEST_URL,
      fetchImpl,
      sleep: sleepSpy,
    })

    expect(result).toEqual({posted: true, status: 200})
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepSpy).toHaveBeenCalledOnce()
  })
})
