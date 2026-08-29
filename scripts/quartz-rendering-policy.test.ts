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

  it('removes raw nodes nested below safe elements', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'div',
          properties: {},
          children: [
            {type: 'element', tagName: 'span', properties: {}, children: [{type: 'raw', value: '<b>bad</b>'}]},
          ],
        },
      ],
    }

    sanitizeHtmlTree(tree)

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [{type: 'element', tagName: 'span', properties: {}, children: []}],
      },
    ])
  })

  it('removes unsafe svg and math elements nested in safe content', () => {
    const tree = {
      type: 'root',
      children: [
        {type: 'element', tagName: 'svg', properties: {}, children: []},
        {type: 'element', tagName: 'math', properties: {}, children: []},
      ],
    }

    sanitizeHtmlTree(tree)

    expect(tree.children).toEqual([])
  })

  it('strips inline style attributes', () => {
    const tree = {
      type: 'root',
      children: [{type: 'element', tagName: 'p', properties: {style: 'color:red', class: 'kept'}, children: []}],
    }

    sanitizeHtmlTree(tree)

    expect(tree.children[0]).toMatchObject({properties: {class: 'kept'}})
    expect(tree.children[0]?.properties).not.toHaveProperty('style')
  })

  it('rejects control-character and entity-obfuscated executable URL schemes', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: {href: 'java\t&#x73;cript:alert(1)'},
          children: [],
        },
      ],
    }

    sanitizeHtmlTree(tree)

    expect(tree.children[0]?.properties).not.toHaveProperty('href')
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
