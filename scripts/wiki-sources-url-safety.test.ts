import {describe, expect, it} from 'vitest'
import {isSafeHttpUrl} from '../quartz-site/components/url-safety.ts'

describe('isSafeHttpUrl', () => {
  it('allows http/https URLs', () => {
    expect(isSafeHttpUrl('https://github.com/owner/repo')).toBe(true)
    expect(isSafeHttpUrl('http://example.com')).toBe(true)
  })

  it('rejects dangerous schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects malformed, empty, and protocol-relative input', () => {
    expect(isSafeHttpUrl('')).toBe(false)
    expect(isSafeHttpUrl('not a url')).toBe(false)
    expect(isSafeHttpUrl('//protocol-relative')).toBe(false)
  })

  it('rejects non-http(s) schemes like mailto', () => {
    expect(isSafeHttpUrl('mailto:x@y.com')).toBe(false)
  })
})
