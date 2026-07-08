import {describe, expect, it} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiUtilsModulePromise: Promise<{
  buildWikiTargetIndex: typeof import('./wiki-utils.js').buildWikiTargetIndex
  collectPageTargets: typeof import('./wiki-utils.js').collectPageTargets
  collectWikiPages: typeof import('./wiki-utils.js').collectWikiPages
  collectWikilinks: typeof import('./wiki-utils.js').collectWikilinks
  parseWikiPage: typeof import('./wiki-utils.js').parseWikiPage
  splitFrontmatter: typeof import('./wiki-utils.js').splitFrontmatter
  truncateToBytes: typeof import('./wiki-utils.js').truncateToBytes
  byteLength: typeof import('./wiki-utils.js').byteLength
}> = import(`./wiki-utils${'.js'}`)
const {
  buildWikiTargetIndex,
  collectPageTargets,
  collectWikiPages,
  collectWikilinks,
  parseWikiPage,
  splitFrontmatter,
  truncateToBytes,
  byteLength,
} = await wikiUtilsModulePromise

describe('splitFrontmatter', () => {
  it('parses well-formed frontmatter into a record and trims the body', () => {
    // #given a page with valid YAML frontmatter and a body
    const content = ['---', 'type: repo', 'title: Fro Bot Agent', '---', '', 'Body text.', ''].join('\n')

    // #when the content is split
    const result = splitFrontmatter(content)

    // #then frontmatter fields and trimmed body are both available, with no error
    expect(result.frontmatter.type).toBe('repo')
    expect(result.frontmatter.title).toBe('Fro Bot Agent')
    expect(result.body).toBe('Body text.')
    expect(result.error).toBeUndefined()
  })

  it('surfaces malformed YAML frontmatter as an observable error instead of silently discarding it', () => {
    // #given frontmatter containing invalid YAML (unterminated flow sequence)
    const content = ['---', 'tags: [unterminated', 'title: Broken', '---', '', 'Body.', ''].join('\n')

    // #when the content is split
    const result = splitFrontmatter(content)

    // #then the error is surfaced so downstream safety logic can observe malformed frontmatter
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Invalid YAML frontmatter')
    expect(result.frontmatter).toEqual({})
  })

  it('returns an empty frontmatter record and trims the body when no frontmatter block exists', () => {
    // #given content with no leading frontmatter delimiter
    const content = 'Just a body, no frontmatter.\n'

    // #when the content is split
    const result = splitFrontmatter(content)

    // #then frontmatter is empty and body is trimmed as-is
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('Just a body, no frontmatter.')
  })
})

describe('collectWikilinks', () => {
  it('collects plain and aliased wikilink targets', () => {
    // #given body text with a plain wikilink and a piped-label wikilink
    const body = 'See [[github-actions-ci]] and [[fro-bot--agent|Fro Bot Agent]] for details.'

    // #when wikilinks are collected
    const targets = collectWikilinks(body)

    // #then both targets resolve to their link target, not the display label
    expect(targets).toEqual(['github-actions-ci', 'fro-bot--agent'])
  })

  it('returns an empty array when the body has no wikilinks', () => {
    // #given plain prose with no wikilink syntax
    // #when wikilinks are collected
    // #then no targets are found
    expect(collectWikilinks('No links here.')).toEqual([])
  })
})

describe('parseWikiPage', () => {
  it('parses frontmatter and body into a page record with path, title, aliases, tags, and body', () => {
    // #given a repo page with aliases and tags
    const content = [
      '---',
      'type: repo',
      'title: Fro Bot Agent',
      'aliases: [fba, agent-repo]',
      'tags: [agent, vitest]',
      '---',
      '',
      'Fro Bot Agent body.',
      '',
    ].join('\n')

    // #when the page is parsed
    const page = parseWikiPage('knowledge/wiki/repos/fro-bot--agent.md', content)

    // #then every field is available on the page record
    expect(page.path).toBe('knowledge/wiki/repos/fro-bot--agent.md')
    expect(page.slug).toBe('fro-bot--agent')
    expect(page.title).toBe('Fro Bot Agent')
    expect(page.type).toBe('repo')
    expect(page.aliases).toEqual(['fba', 'agent-repo'])
    expect(page.tags).toEqual(['agent', 'vitest'])
    expect(page.body).toBe('Fro Bot Agent body.')
  })

  it('infers type from path and falls back to slug title when frontmatter is missing them', () => {
    // #given a topic page with no explicit type/title in frontmatter
    const content = ['---', 'created: 2026-04-16', '---', '', 'Body.', ''].join('\n')

    // #when the page is parsed
    const page = parseWikiPage('knowledge/wiki/topics/vitest.md', content)

    // #then type is inferred from the path and title falls back to the slug
    expect(page.type).toBe('topic')
    expect(page.title).toBe('vitest')
  })
})

describe('collectWikiPages', () => {
  it('collects only knowledge/wiki/**.md files from a path->content map', () => {
    // #given a mixed file map containing wiki pages and a non-wiki file
    const files = {
      'knowledge/index.md': '# Wiki Index\n',
      'knowledge/wiki/repos/fro-bot--agent.md': '---\ntype: repo\ntitle: Fro Bot Agent\n---\n\nBody.\n',
      'knowledge/wiki/topics/vitest.md': '---\ntype: topic\ntitle: Vitest\n---\n\nBody.\n',
      'README.md': '# readme\n',
    }

    // #when wiki pages are collected
    const pages = collectWikiPages(files)

    // #then only the two knowledge/wiki/**.md files are returned
    expect(pages.map(page => page.path).sort()).toEqual([
      'knowledge/wiki/repos/fro-bot--agent.md',
      'knowledge/wiki/topics/vitest.md',
    ])
  })
})

describe('buildWikiTargetIndex', () => {
  const pages = [
    parseWikiPage(
      'knowledge/wiki/repos/fro-bot--agent.md',
      ['---', 'type: repo', 'title: Fro Bot Agent', 'aliases: [fba]', '---', '', 'Body.', ''].join('\n'),
    ),
    parseWikiPage(
      'knowledge/wiki/topics/vitest.md',
      ['---', 'type: topic', 'title: Vitest', '---', '', 'Body.', ''].join('\n'),
    ),
    // Second page deliberately reuses alias "dup" to create an ambiguous target.
    parseWikiPage(
      'knowledge/wiki/entities/octokit.md',
      ['---', 'type: entity', 'title: Octokit', 'aliases: [dup]', '---', '', 'Body.', ''].join('\n'),
    ),
    parseWikiPage(
      'knowledge/wiki/comparisons/dup-example.md',
      ['---', 'type: comparison', 'title: Dup Example', 'aliases: [dup]', '---', '', 'Body.', ''].join('\n'),
    ),
  ]

  it('resolves link targets through page path, slug, and alias', () => {
    // #given an indexed path/slug/alias map built from the page collection
    const index = buildWikiTargetIndex(pages)

    // #when resolving by slug, alias, and full path
    // #then all three resolve to the correct page record, not a lint finding
    expect(index.resolve('fro-bot--agent')?.path).toBe('knowledge/wiki/repos/fro-bot--agent.md')
    expect(index.resolve('fba')?.path).toBe('knowledge/wiki/repos/fro-bot--agent.md')
    expect(index.resolve('knowledge/wiki/topics/vitest.md')?.path).toBe('knowledge/wiki/topics/vitest.md')
  })

  it('skips ambiguous targets instead of fuzzy-matching to either candidate', () => {
    // #given two pages that both declare the alias "dup"
    const index = buildWikiTargetIndex(pages)

    // #when resolving the ambiguous alias
    // #then resolution returns undefined rather than picking one page arbitrarily
    expect(index.resolve('dup')).toBeUndefined()
  })

  it('skips missing targets instead of fuzzy-matching to a similar slug', () => {
    // #given an indexed map with no page matching a near-miss target
    const index = buildWikiTargetIndex(pages)

    // #when resolving a target that does not exist
    // #then resolution returns undefined
    expect(index.resolve('fro-bot--agnt')).toBeUndefined()
  })
})

describe('collectPageTargets', () => {
  it('collects slugs and aliases from a page collection into a single target set', () => {
    // #given pages with slugs and declared aliases
    const pages = [
      {slug: 'fro-bot--agent', aliases: ['fba']},
      {slug: 'vitest', aliases: []},
    ]

    // #when page targets are collected
    const targets = collectPageTargets(pages)

    // #then both slugs and aliases are present in the resulting set
    expect(targets.has('fro-bot--agent')).toBe(true)
    expect(targets.has('fba')).toBe(true)
    expect(targets.has('vitest')).toBe(true)
  })
})

describe('truncateToBytes', () => {
  it('truncates multi-byte utf8 content within the byte cap without emitting replacement characters', () => {
    // #given emoji-heavy text that must be sliced mid-sequence to fit the byte budget
    const emojiHeavyBody = 'Deploy notes 😀😀😀 remain valid after truncation.'.repeat(20)

    // #when truncated to a small byte budget
    const truncated = truncateToBytes(emojiHeavyBody, 40)

    // #then the result stays within budget and contains no replacement characters
    expect(byteLength(truncated)).toBeLessThanOrEqual(40)
    expect(truncated).not.toContain('\uFFFD')
  })

  it('returns the original value unchanged when it already fits the byte budget', () => {
    // #given short text under the byte cap
    // #when truncated
    // #then the value is returned unchanged
    expect(truncateToBytes('short', 100)).toBe('short')
  })

  it('returns an empty string for a near-zero byte budget that cannot fit content plus the ellipsis marker', () => {
    // #given a byte budget too small to hold any content once the ellipsis marker is reserved
    // #when truncated to 0, 1, and 2 bytes (ellipsis is a 3-byte UTF-8 character)
    // #then no replacement characters or partial ellipsis bytes are ever emitted
    expect(truncateToBytes('some longer content that must be truncated', 0)).toBe('')
    expect(truncateToBytes('some longer content that must be truncated', 1)).toBe('')
    expect(truncateToBytes('some longer content that must be truncated', 2)).toBe('')
  })
})
