import {describe, expect, it} from 'vitest'

import {parseFrontmatterDocument} from './frontmatter.ts'
import {buildWikiIngestChanges} from './wiki-ingest.ts'
import {splitFrontmatter} from './wiki-utils.ts'

// A closing delimiter is a line that is exactly `---`. Lines that merely start with `---`
// are YAML content (here: mapping keys) and stay inside the frontmatter.
const KEY_LINES = ['---x: kept', '----: kept'] as const

const PAGE_PATH = 'knowledge/wiki/topics/delimiter.md'

function ingest(content: string): Record<string, string> {
  return buildWikiIngestChanges({
    existingFiles: {'knowledge/index.md': '# Wiki Index\n', 'knowledge/log.md': '# Wiki Log\n'},
    operation: 'survey',
    target: 'topic:delimiter',
    summary: 'Delimiter test.',
    timestamp: new Date('2026-08-29T12:34:00.000Z'),
    sources: [],
    pages: [{path: PAGE_PATH, content}],
  }).files
}

describe('splitFrontmatter closing delimiter', () => {
  it.each(KEY_LINES)('keeps a %s line inside the frontmatter', keyLine => {
    const result = splitFrontmatter(`---\ntitle: x\n${keyLine}\nstatus: active\n---\nbody\n`)

    expect(result.error).toBeUndefined()
    expect(result.frontmatter.title).toBe('x')
    expect(result.frontmatter.status).toBe('active')
    expect(result.body).toBe('body')
  })

  it('does not close on a line with text after the dashes', () => {
    const content = '---\ntitle: x\n--- trailing text\nbody\n'

    expect(splitFrontmatter(content)).toEqual({frontmatter: {}, body: content.trim()})
  })

  it('closes on `---` at the end of the content with no newline', () => {
    expect(splitFrontmatter('---\ntitle: x\n---')).toEqual({frontmatter: {title: 'x'}, body: ''})
  })
})

describe('parseFrontmatterDocument closing delimiter', () => {
  it.each(KEY_LINES)('keeps a %s line inside the frontmatter', keyLine => {
    const document = parseFrontmatterDocument(`---\ntitle: x\n${keyLine}\nstatus: active\n---\nbody\n`)

    expect(document.values.status).toBe('active')
    expect(document.body).toBe('body\n')
  })

  it('does not close on a line with text after the dashes', () => {
    expect(() => parseFrontmatterDocument('---\ntitle: x\n--- trailing text\nbody\n')).toThrow(
      'validated wiki page is missing frontmatter',
    )
  })

  it('closes on `---` at the end of the content with no newline', () => {
    expect(parseFrontmatterDocument('---\ntitle: x\n---')).toEqual({values: {title: 'x'}, body: ''})
  })
})

describe('wiki ingest closing delimiter', () => {
  const required = ['type: topic', 'title: Delimiter', 'created: 2026-08-29']

  it.each(KEY_LINES)('reads required fields that follow a %s line', keyLine => {
    const content = [
      '---',
      ...required.slice(0, 2),
      keyLine,
      'created: 2026-08-29',
      'updated: 2026-08-29',
      '---',
      '',
      'Notes.',
      '',
    ].join('\n')

    expect(ingest(content)[PAGE_PATH]).toContain('Notes.')
  })

  it('does not close on a line with text after the dashes', () => {
    const content = ['---', ...required, 'updated: 2026-08-29', '--- trailing text', 'Notes.', ''].join('\n')

    expect(() => ingest(content)).toThrow(`${PAGE_PATH} is missing YAML frontmatter`)
  })

  it.each(KEY_LINES)('strips database_id that follows a %s line', keyLine => {
    const content = [
      '---',
      ...required,
      'updated: 2026-08-29',
      keyLine,
      'database_id: 42',
      '---',
      '',
      'Notes.',
      '',
    ].join('\n')

    const written = ingest(content)[PAGE_PATH] ?? ''

    expect(written).toContain('Notes.')
    expect(written).not.toContain('database_id')
  })
})
