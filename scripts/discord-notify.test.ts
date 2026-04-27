import type {DiscordEmbedParams} from './discord-notify.ts'

import {describe, expect, it, vi} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const discordModulePromise: Promise<{
  postDiscordEmbed: typeof import('./discord-notify.js').postDiscordEmbed
}> = import(`./discord-notify${'.js'}`)
const {postDiscordEmbed} = await discordModulePromise

describe('postDiscordEmbed', () => {
  it('skips when DISCORD_WEBHOOK_URL is not set', async () => {
    const result = await postDiscordEmbed({title: 'Test'})
    expect(result.posted).toBe(false)
    expect(result.skipped).toMatch(/DISCORD_WEBHOOK_URL not set/)
  })

  it('posts an embed and returns posted:true on 204', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {status: 204}))

    const params: DiscordEmbedParams = {
      title: 'New invitation accepted',
      description: 'Accepted invite from marcusrbrown/ha-config',
      webhookUrl: 'https://discord.com/api/webhooks/test/token',
    }
    const result = await postDiscordEmbed(params)

    expect(result.posted).toBe(true)
    expect(result.status).toBe(204)
    expect(fetchSpy).toHaveBeenCalledOnce()

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(params.webhookUrl)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect((body.embeds as unknown[])[0]).toMatchObject({title: 'New invitation accepted'})

    fetchSpy.mockRestore()
  })

  it('accepts 200 response as success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok', {status: 200}))
    const result = await postDiscordEmbed({
      title: 'Test',
      webhookUrl: 'https://discord.com/api/webhooks/test/token',
    })
    expect(result.posted).toBe(true)
    fetchSpy.mockRestore()
  })

  it('returns posted:false on non-retryable failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', {status: 403}))
    const result = await postDiscordEmbed({
      title: 'Test',
      webhookUrl: 'https://discord.com/api/webhooks/test/token',
    })
    expect(result.posted).toBe(false)
    expect(result.status).toBe(403)
    fetchSpy.mockRestore()
  })

  it('retries on 429 and succeeds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({retry_after: 0.001}), {
          status: 429,
          headers: {'Content-Type': 'application/json'},
        }),
      )
      .mockResolvedValueOnce(new Response(null, {status: 204}))

    const result = await postDiscordEmbed({
      title: 'Test',
      webhookUrl: 'https://discord.com/api/webhooks/test/token',
    })
    expect(result.posted).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    fetchSpy.mockRestore()
  })

  it('returns posted:false after exhausting all retries on 429', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({retry_after: 0.001}), {
          status: 429,
          headers: {'Content-Type': 'application/json'},
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({retry_after: 0.001}), {
          status: 429,
          headers: {'Content-Type': 'application/json'},
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({retry_after: 0.001}), {
          status: 429,
          headers: {'Content-Type': 'application/json'},
        }),
      )
    const result = await postDiscordEmbed({
      title: 'Test',
      webhookUrl: 'https://discord.com/api/webhooks/test/token',
    })
    expect(result.posted).toBe(false)
    expect(result.status).toBe(429)
    fetchSpy.mockRestore()
  })

  it('includes fields, footer, and timestamp in embed payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {status: 204}))

    await postDiscordEmbed({
      title: 'Embed title',
      description: 'desc',
      fields: [{name: 'Repo', value: 'owner/repo', inline: true}],
      footerText: 'Fro Bot',
      timestamp: '2026-01-01T00:00:00Z',
      webhookUrl: 'https://discord.com/api/webhooks/test/token',
    })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const embed = (body.embeds as Record<string, unknown>[])[0] ?? {}
    expect(embed.fields).toEqual([{name: 'Repo', value: 'owner/repo', inline: true}])
    expect(embed.footer).toMatchObject({text: 'Fro Bot'})
    expect(embed.timestamp).toBe('2026-01-01T00:00:00Z')
    fetchSpy.mockRestore()
  })
})
