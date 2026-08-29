import {describe, expect, it} from 'vitest'

import {sanitizeHtmlTree} from '../quartz-site/local-plugin/sanitizer/dist/index.js'

describe('Quartz rendering policy', () => {
  it('removes raw scriptable HTML from the rendered tree', () => {
    const tree = {
      type: 'root',
      children: [
        {type: 'text', value: 'safe text'},
        {type: 'raw', value: '<script>alert(1)</script>'},
      ],
    }

    sanitizeHtmlTree(tree)

    expect(tree.children).toEqual([{type: 'text', value: 'safe text'}])
  })

  it('removes unsafe event handlers and executable URLs from element attributes', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: {
            href: 'javascript:alert(1)',
            onclick: 'alert(1)',
            class: 'kept',
          },
          children: [{type: 'text', value: 'link'}],
        },
      ],
    }

    sanitizeHtmlTree(tree)

    expect(tree.children[0]).toMatchObject({properties: {class: 'kept'}})
  })

  it('removes executable image source lists', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'img',
          properties: {srcset: 'data:image/svg+xml,<svg onload=alert(1)>'},
          children: [],
        },
      ],
    }

    sanitizeHtmlTree(tree)

    expect(JSON.stringify(tree.children[0])).not.toContain('srcset')
  })
})
