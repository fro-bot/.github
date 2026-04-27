import process from 'node:process'

/** Fro Bot brand color — deep cosmic purple. */
const FRO_BOT_COLOR = 0x6b2fdb
const FRO_BOT_USERNAME = 'Fro Bot'
const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 1000

export interface DiscordField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbedParams {
  title?: string
  description?: string
  url?: string
  color?: number
  fields?: DiscordField[]
  imageUrl?: string
  footerText?: string
  footerIconUrl?: string
  /** ISO 8601 timestamp for the embed footer. */
  timestamp?: string
  /** Override the webhook URL. Defaults to the DISCORD_WEBHOOK_URL env var. */
  webhookUrl?: string
}

export interface DiscordNotifyResult {
  posted: boolean
  skipped?: string
  status?: number
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Post an embed to a Discord channel via webhook.
 *
 * Returns `{posted: false, skipped}` immediately when the webhook URL is
 * absent so callers do not need to guard against missing credentials.
 *
 * Retries up to {@link MAX_RETRIES} times on 429 rate-limit responses,
 * honouring the server-provided `retry_after` value when present.
 */
export async function postDiscordEmbed(params: DiscordEmbedParams): Promise<DiscordNotifyResult> {
  const webhookUrl = params.webhookUrl ?? process.env.DISCORD_WEBHOOK_URL
  if (webhookUrl === undefined || webhookUrl === '') {
    return {posted: false, skipped: 'DISCORD_WEBHOOK_URL not set — skipping Discord notification'}
  }

  const embed: Record<string, unknown> = {
    color: params.color ?? FRO_BOT_COLOR,
  }
  if (params.title !== undefined) embed.title = params.title
  if (params.description !== undefined) embed.description = params.description
  if (params.url !== undefined) embed.url = params.url
  if (params.fields !== undefined && params.fields.length > 0) embed.fields = params.fields
  if (params.imageUrl !== undefined) embed.image = {url: params.imageUrl}
  if (params.footerText !== undefined) {
    const footer: Record<string, string> = {text: params.footerText}
    if (params.footerIconUrl !== undefined) footer.icon_url = params.footerIconUrl
    embed.footer = footer
  }
  if (params.timestamp !== undefined) embed.timestamp = params.timestamp

  const payload = {
    username: FRO_BOT_USERNAME,
    embeds: [embed],
  }
  const body = JSON.stringify(payload)

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body,
    })

    if (response.status === 204 || response.status === 200) {
      return {posted: true, status: response.status}
    }

    if (response.status === 429) {
      // Honour the server-provided retry hint; fall back to exponential backoff.
      let waitMs = BACKOFF_BASE_MS * 2 ** attempt
      const retryAfterHeader = response.headers.get('Retry-After')
      const rateLimitBody = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (typeof rateLimitBody.retry_after === 'number') {
        waitMs = Math.ceil(rateLimitBody.retry_after * 1000)
      } else if (retryAfterHeader !== null) {
        const parsed = Number.parseFloat(retryAfterHeader)
        if (!Number.isNaN(parsed)) waitMs = Math.ceil(parsed * 1000)
      }
      await sleep(waitMs)
      continue
    }

    // Non-retryable failure.
    return {posted: false, status: response.status}
  }

  // All retries exhausted.
  return {posted: false, status: 429}
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx === -1 ? undefined : args[idx + 1]
  }
  const message = get('--message')
  if (message === undefined || message === '') {
    process.stderr.write('--message is required\n')
    process.exit(1)
  }
  const result = await postDiscordEmbed({
    title: get('--title'),
    description: message,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
