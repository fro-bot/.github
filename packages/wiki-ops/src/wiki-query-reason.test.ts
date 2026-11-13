/**
 * The reason a skipped page is reported with comes from the kind the wiki page reader sets next to its error text,
 * never from the wording of that text. The reader is wrapped here so the text of every error is replaced, and the
 * text of one page carries the other kind's old wording; only the kind is left to tell the pages apart.
 */
import {describe, expect, it, vi} from 'vitest'

import {assembleWikiContext} from './wiki-query.ts'

vi.mock('@fro.bot/wiki-write-core/wiki-utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@fro.bot/wiki-write-core/wiki-utils')>()
  return {
    ...actual,
    collectWikiPages: (files: Record<string, string>) =>
      actual.collectWikiPages(files).map(page =>
        page.frontmatterError === undefined
          ? page
          : {
              ...page,
              frontmatterError: page.path.endsWith('invalid.md')
                ? 'Invalid frontmatter: missing closing --- delimiter'
                : 'the reader changed this wording',
            },
      ),
  }
})

const FILES: Record<string, string> = {
  'knowledge/wiki/topics/fine.md': '---\ntype: topic\ntitle: Vitest\ntags: [vitest]\n---\n\nVitest is the runner.\n',
  'knowledge/wiki/topics/unclosed.md': '---\ntype: topic\ntitle: Unclosed\n',
  'knowledge/wiki/topics/invalid.md': '---\ntype: topic\ntitle: [\n---\n\nBody.\n',
}

describe('assembleWikiContext: the reason a page is skipped', () => {
  it('follows the kind of the error, not the wording of its text', () => {
    const result = assembleWikiContext({files: FILES, event: {eventName: 'issues', title: 'vitest'}})
    expect(result.skippedPages).toStrictEqual([
      {path: 'knowledge/wiki/topics/invalid.md', reason: 'invalid-frontmatter'},
      {path: 'knowledge/wiki/topics/unclosed.md', reason: 'unclosed-frontmatter'},
    ])
  })
})
