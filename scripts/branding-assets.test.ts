import {Buffer} from 'node:buffer'
import {readFile} from 'node:fs/promises'

import {describe, expect, it} from 'vitest'

const fontDataPattern = /data:font\/ttf;base64,([A-Za-z0-9+/=]+)/g

describe('branding SVG embedded font', () => {
  it.each(['banner-template.svg', 'banner.svg'])('%s decodes to ArchivoBlack-Regular.ttf bytes', async name => {
    const svg = await readFile(new URL(`../assets/${name}`, import.meta.url), 'utf8')
    const font = await readFile(new URL('../assets/fonts/ArchivoBlack-Regular.ttf', import.meta.url))

    const matches = [...svg.matchAll(fontDataPattern)]
    expect(matches).toHaveLength(1)

    const payload = matches[0]?.[1]
    expect(payload).toBeDefined()
    if (payload === undefined) throw new Error('unreachable: payload defined above')

    expect(Buffer.from(payload, 'base64').equals(font)).toBe(true)
  })
})
