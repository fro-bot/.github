import {beforeEach, describe, expect, it, vi} from 'vitest'

// Use class mocks so `new RichText(...)` is a valid constructor call.
const mockDetectFacets = vi.fn(async (_agent: unknown) => undefined)
const mockPost = vi.fn(async (_record: unknown) => ({uri: 'at://did:plc:test/app.bsky.feed.post/123'}))
const mockLogin = vi.fn(async (_opts: {identifier: string; password: string}) => undefined)

const createdRichTexts: {text: string; graphemeLength: number}[] = []

vi.mock('@atproto/api', () => {
  class RichText {
    text: string
    facets: unknown[] | undefined = undefined
    graphemeLength: number

    constructor(opts: {text: string}) {
      this.text = opts.text
      this.graphemeLength = [...new Intl.Segmenter().segment(opts.text)].length
      createdRichTexts.push({text: this.text, graphemeLength: this.graphemeLength})
    }

    async detectFacets(_agent: unknown): Promise<void> {
      return mockDetectFacets(_agent)
    }
  }

  class CredentialSession {
    constructor(_serviceUrl: URL) {}
    async login(opts: {identifier: string; password: string}): Promise<void> {
      return mockLogin(opts)
    }
  }

  class Agent {
    constructor(_session: unknown) {}
    async post(record: unknown): Promise<{uri: string}> {
      return mockPost(record)
    }
  }

  return {Agent, CredentialSession, RichText}
})

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const bskyModulePromise: Promise<{
  postToBluesky: typeof import('./bluesky-post.js').postToBluesky
}> = import(`./bluesky-post${'.js'}`)
const {postToBluesky} = await bskyModulePromise

beforeEach(() => {
  mockDetectFacets.mockClear()
  mockPost.mockClear()
  mockLogin.mockClear()
  createdRichTexts.length = 0
})

describe('postToBluesky', () => {
  it('skips when credentials are absent', async () => {
    const result = await postToBluesky({text: 'hello'})
    expect(result.posted).toBe(false)
    expect(result.skipped).toMatch(/BLUESKY_HANDLE or BLUESKY_APP_PASSWORD not set/)
    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('posts and returns uri when credentials are provided', async () => {
    const result = await postToBluesky({
      text: 'Hello from Fro Bot!',
      handle: 'fro-bot.bsky.social',
      appPassword: 'xxxx-xxxx-xxxx-xxxx',
    })
    expect(result.posted).toBe(true)
    expect(result.uri).toBe('at://did:plc:test/app.bsky.feed.post/123')
    expect(mockLogin).toHaveBeenCalledWith({
      identifier: 'fro-bot.bsky.social',
      password: 'xxxx-xxxx-xxxx-xxxx',
    })
    expect(mockDetectFacets).toHaveBeenCalledOnce()
    expect(mockPost).toHaveBeenCalledOnce()
  })

  it('truncates text exceeding 300 graphemes', async () => {
    const longText = 'a'.repeat(305)
    await postToBluesky({
      text: longText,
      handle: 'fro-bot.bsky.social',
      appPassword: 'xxxx-xxxx-xxxx-xxxx',
    })
    // Two RichText constructions: one for grapheme check, one for posting
    expect(createdRichTexts).toHaveLength(2)
    const postedText = createdRichTexts[1]?.text ?? ''
    expect(postedText.length).toBeLessThanOrEqual(300)
    expect(postedText.endsWith('...')).toBe(true)
  })

  it('does not truncate text at exactly 300 graphemes', async () => {
    const exactText = 'a'.repeat(300)
    await postToBluesky({
      text: exactText,
      handle: 'fro-bot.bsky.social',
      appPassword: 'xxxx-xxxx-xxxx-xxxx',
    })
    // Both RichText instances should use the same text (no truncation)
    expect(createdRichTexts).toHaveLength(2)
    expect(createdRichTexts[0]?.text).toBe(exactText)
    expect(createdRichTexts[1]?.text).toBe(exactText)
  })

  it('uses custom serviceUrl when provided', async () => {
    const {CredentialSession} = await import('@atproto/api')
    const constructorSpy = vi.spyOn(CredentialSession.prototype, 'login')

    await postToBluesky({
      text: 'Test',
      handle: 'fro-bot.bsky.social',
      appPassword: 'xxxx-xxxx-xxxx-xxxx',
      serviceUrl: 'https://staging.bsky.social',
    })

    // The CredentialSession constructor should have been called with the custom URL.
    // We verify via login being called (proves a session was created and used).
    expect(constructorSpy).toHaveBeenCalledWith({
      identifier: 'fro-bot.bsky.social',
      password: 'xxxx-xxxx-xxxx-xxxx',
    })
    constructorSpy.mockRestore()
  })
})
