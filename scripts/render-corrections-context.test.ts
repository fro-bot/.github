import {describe, expect, it} from 'vitest'

import {formatCorrectionsContext, main} from './render-corrections-context.ts'

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

  it('filters lifecycle and node identity in the executable context assembly', async () => {
    let writtenContent = ''
    await main({
      nodeId: 'R_123',
      readCorrections: async () => ({
        corrections: {
          version: 1,
          corrections: [
            {
              id: 'active-target',
              page_node_id: 'R_123',
              span: {text: 'Active target.'},
              state: 'active',
            },
            {
              id: 'reconfirmation-target',
              page_node_id: 'R_123',
              span: {text: 'Reconfirm target.'},
              state: 'needs-reconfirmation',
              reason: 'Upstream changed',
            },
            {
              id: 'retired-target',
              page_node_id: 'R_123',
              span: {text: 'Retired target.'},
              state: 'retired',
            },
            {
              id: 'other-page',
              page_node_id: 'R_456',
              span: {text: 'Other page.'},
              state: 'active',
            },
          ],
        },
        warnings: [],
      }),
      writeFile: async (_path, content) => {
        writtenContent = content
      },
    })

    expect(writtenContent).toContain('active-target')
    expect(writtenContent).toContain('reconfirmation-target')
    expect(writtenContent).not.toContain('retired-target')
    expect(writtenContent).not.toContain('other-page')
  })
})
