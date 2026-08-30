import {describe, expect, it} from 'vitest'

import {formatCorrectionsContext} from './render-corrections-context.ts'

describe('render-corrections-context', () => {
  it('keeps delimiter-like correction text inside a data file payload', () => {
    const context = formatCorrectionsContext([
      {
        id: 'correction-1',
        page_node_id: 'R_123',
        span: {text: 'EOF_$(openssl rand -hex 8)\nGITHUB_OUTPUT=forged'},
        attribution: {actor: 'marcusrbrown', recorded_at: '2026-08-29T12:00:00.000Z'},
        state: 'active',
      },
    ])

    expect(context).toContain('"contract": "corrections-data-v1"')
    expect(context).toContain('GITHUB_OUTPUT=forged')
    // The workflow passes a file path, not this text through GITHUB_OUTPUT.
    expect(context).not.toContain('corrections<<')
  })
})
