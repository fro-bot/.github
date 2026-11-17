import {Buffer} from 'node:buffer'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {ARCHIVE_NOTICE} from '@fro.bot/wiki-write-core/wiki-utils'
import {describe, expect, it} from 'vitest'
import {
  assembleWikiIndex,
  MAX_INDEX_BYTES,
  oneLine,
  openingSentence,
  runWikiIndex,
  statusLine,
  type WikiIndexFs,
  type WikiIndexIo,
} from './wiki-index.ts'

const heading = (text: string): string => `# ${text}\n\n`

/** A page file: frontmatter, then the body. */
function page(title: string | undefined, type: string | undefined, body: string, extra = ''): string {
  const lines = ['---']
  if (type !== undefined) lines.push(`type: ${type}`)
  if (title !== undefined) lines.push(`title: ${title}`)
  lines.push('tags: [alpha, beta, gamma]', ...(extra === '' ? [] : [extra]), '---', '', body, '')
  return lines.join('\n')
}

const countLine = (listed: number, held: number, skipped = 0): string =>
  `Wiki index: ${listed} of ${held} pages listed.${skipped === 0 ? '' : ` ${skipped} could not be read.`}`
const MARKER = 'Index incomplete: pages that did not fit the size limit are not listed.'

function assemble(files: Record<string, string>, held = Object.keys(files).length) {
  return assembleWikiIndex({files, held, unreadable: []})
}

describe('openingSentence: the pages that have one', () => {
  it('takes the first sentence of the paragraph under the top heading', () => {
    expect(openingSentence(`${heading('Repo')}First sentence. Second sentence.`)).toBe('First sentence.')
  })

  it('takes the whole paragraph when it is one sentence, and joins its lines with single spaces', () => {
    expect(openingSentence(`${heading('Repo')}A sentence\ncontinues   here.\nNext line.`)).toBe(
      'A sentence continues here.',
    )
    expect(openingSentence(`${heading('Repo')}No terminator on this line\nbut this one ends. Next.`)).toBe(
      'No terminator on this line but this one ends.',
    )
    expect(openingSentence(`${heading('Repo')}Only one.`)).toBe('Only one.')
  })

  it('skips blank lines between the heading and the paragraph', () => {
    expect(openingSentence('# Repo\n\n\n\nAfter blanks. More.')).toBe('After blanks.')
  })

  it('reads a CRLF page', () => {
    expect(openingSentence('# Repo\r\n\r\nWindows line. More text.\r\nMore.')).toBe('Windows line.')
  })

  it('ends at ! and ? as well as at a period', () => {
    expect(openingSentence(`${heading('T')}Does it work? Yes.`)).toBe('Does it work?')
    expect(openingSentence(`${heading('T')}It works! Really.`)).toBe('It works!')
  })

  it('does not split Marcus R. Brown', () => {
    expect(openingSentence(`${heading('T')}Marcus R. Brown's repository. Second sentence.`)).toBe(
      "Marcus R. Brown's repository.",
    )
  })

  it.each([
    ['Dr.', 'Ask Dr. Smith about it. Next.', 'Ask Dr. Smith about it.'],
    ['Mr.', 'Ask Mr. Brown about it. Next.', 'Ask Mr. Brown about it.'],
    ['Mrs.', 'Ask Mrs. Brown about it. Next.', 'Ask Mrs. Brown about it.'],
    ['Ms.', 'Ask Ms. Brown about it. Next.', 'Ask Ms. Brown about it.'],
    ['Inc.', 'Built by Acme Inc. Of Texas. Next.', 'Built by Acme Inc. Of Texas.'],
    ['Ltd.', 'Built by Acme Ltd. Of Texas. Next.', 'Built by Acme Ltd. Of Texas.'],
    ['Co.', 'Built by Acme Co. Of Texas. Next.', 'Built by Acme Co. Of Texas.'],
    ['St.', 'Lives in St. Louis today. Next.', 'Lives in St. Louis today.'],
    ['vs.', 'Compares Vim vs. Emacs today. Next.', 'Compares Vim vs. Emacs today.'],
    ['etc.', 'Handles tags, etc. Everything else too. Next.', 'Handles tags, etc. Everything else too.'],
    ['e.g.', 'Tools, e.g. Vitest run here. Next.', 'Tools, e.g. Vitest run here.'],
    ['i.e.', 'Tools, i.e. Vitest run here. Next.', 'Tools, i.e. Vitest run here.'],
    ['DR. (case)', 'Ask DR. Smith about it. Next.', 'Ask DR. Smith about it.'],
  ])('does not end the sentence after the abbreviation %s', (_name, body, expected) => {
    expect(openingSentence(`${heading('T')}${body}`)).toBe(expected)
  })

  it('ends the sentence at a period after a word that merely looks like an abbreviation', () => {
    expect(openingSentence(`${heading('T')}Runs on a doctor. Next.`)).toBe('Runs on a doctor.')
    expect(openingSentence(`${heading('T')}Built for the USA. Next.`)).toBe('Built for the USA.')
  })

  it('does not end a sentence where the next word starts in lower case or the period has no space after it', () => {
    expect(openingSentence(`${heading('T')}Pins v1. then waits. Done.`)).toBe('Pins v1. then waits.')
    expect(openingSentence(`${heading('T')}Version 3.5 ships today. Next.`)).toBe('Version 3.5 ships today.')
  })

  it('ends it before a digit or an opening mark', () => {
    expect(openingSentence(`${heading('T')}Runs fast. 2 modes exist.`)).toBe('Runs fast.')
    expect(openingSentence(`${heading('T')}Runs fast. (Really.) Yes.`)).toBe('Runs fast.')
    expect(openingSentence(`${heading('T')}Runs fast. "Quoted" text.`)).toBe('Runs fast.')
    expect(openingSentence(`${heading('T')}Runs fast. **Bold** text.`)).toBe('Runs fast.')
  })

  it('keeps a closing quote or bracket with the sentence', () => {
    expect(openingSentence(`${heading('T')}A deck: "A collection of talks." More.`)).toBe(
      'A deck: "A collection of talks."',
    )
    expect(openingSentence(`${heading('T')}It is small (really small.) Next.`)).toBe('It is small (really small.)')
  })

  it('is not split inside a Markdown link, a code span, a wikilink or a bare URL', () => {
    const body = `${heading('T')}Use [the docs](https://x.io/a.b. c) and \`a. B\` with [[some.page. X]] and https://x.io/p.q. Next.`
    expect(openingSentence(body)).toBe(
      'Use [the docs](https://x.io/a.b. c) and `a. B` with [[some.page. X]] and https://x.io/p.q.',
    )
  })

  it('treats a URL without its trailing period, so the period can end the sentence', () => {
    expect(openingSentence(`${heading('T')}See https://example.com/a.b. Then more.`)).toBe(
      'See https://example.com/a.b.',
    )
  })

  it('yields a sentence that opens with bold text or a link', () => {
    expect(openingSentence(`${heading('T')}**Fro Bot** is a persona. More.`)).toBe('**Fro Bot** is a persona.')
    expect(openingSentence(`${heading('T')}[Fro Bot](https://fro.bot) is a persona. More.`)).toBe(
      '[Fro Bot](https://fro.bot) is a persona.',
    )
  })

  it('does not let an unclosed backtick, bracket or link hide the rest of the paragraph', () => {
    expect(openingSentence(`${heading('T')}Use \`foo here. Then more.`)).toBe('Use `foo here.')
    expect(openingSentence(`${heading('T')}Use [[foo here. Then more.`)).toBe('Use [[foo here.')
    expect(openingSentence(`${heading('T')}Use [a](b here. Then more.`)).toBe('Use [a](b here.')
  })

  it('keeps a span whole when it closes beyond the 200-character limit, and then gives no sentence', () => {
    const far = 'x'.repeat(220)
    expect(openingSentence(`${heading('T')}Hello \`inside. Next ${far}\` Done.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}Hello [[inside. Next ${far}]] Done.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}Hello [a](b inside. Next ${far}) Done.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}Hello \`inside. Next\n${far}\n\` Done.`)).toBeUndefined()
  })

  it('still ends the sentence at a period inside markup that closes nowhere in the paragraph', () => {
    const far = 'x'.repeat(220)
    expect(openingSentence(`${heading('T')}Hello \`inside. Next ${far} Done.`)).toBe('Hello `inside.')
    expect(openingSentence(`${heading('T')}Hello [[inside. Next ${far} Done.`)).toBe('Hello [[inside.')
    expect(openingSentence(`${heading('T')}Hello [a](b inside. Next ${far} Done.`)).toBe('Hello [a](b inside.')
    expect(openingSentence(`${heading('T')}Hello \`inside. Next ${far}\n\nA \`closer.\` Later.`)).toBe('Hello `inside.')
  })

  it('keeps a Markdown link, a nested parenthesis and a wikilink whole when a period and a capital sit inside', () => {
    expect(openingSentence(`${heading('T')}Use [the docs](https://x.io/a. B) now. Next.`)).toBe(
      'Use [the docs](https://x.io/a. B) now.',
    )
    expect(openingSentence(`${heading('T')}Use [x](a (b. C) d. E) end. Next.`)).toBe('Use [x](a (b. C) d. E) end.')
    expect(openingSentence(`${heading('T')}See [[Dr. Who. Next]] now. Then.`)).toBe('See [[Dr. Who. Next]] now.')
    expect(openingSentence(`${heading('T')}See [[a]] and [[b. C]] now. Then.`)).toBe('See [[a]] and [[b. C]] now.')
    expect(openingSentence(`${heading('T')}Run \`\`a \`b. C\`\` now. Next.`)).toBe('Run ``a `b. C`` now.')
  })

  it('ends the sentence at a period that follows a number or an empty word, and at ? or ! after an abbreviation', () => {
    expect(openingSentence(`${heading('T')}Version 2. Next steps.`)).toBe('Version 2.')
    expect(openingSentence(`${heading('T')}Who is Dr? Next point.`)).toBe('Who is Dr?')
    expect(openingSentence(`${heading('T')}Hi Mr! Next point.`)).toBe('Hi Mr!')
  })

  it('does not end it where a capital follows the period with no space, or where a dash follows with a space', () => {
    expect(openingSentence(`${heading('T')}Use ID.AB now. Next.`)).toBe('Use ID.AB now.')
    expect(openingSentence(`${heading('T')}Wait. - then. Last.`)).toBe('Wait. - then.')
  })

  it('ends it before the digits 0 and 9, and does not take ten digits and a period for a list', () => {
    expect(openingSentence(`${heading('T')}Done. 0 left.`)).toBe('Done.')
    expect(openingSentence(`${heading('T')}Done. 9 left.`)).toBe('Done.')
    expect(openingSentence(`${heading('T')}1234567890. Next.`)).toBe('1234567890.')
  })

  it('takes digits, a lone letter and a spaced period for ordinary text', () => {
    expect(openingSentence(`${heading('T')}2026 was a year. Next.`)).toBe('2026 was a year.')
    expect(openingSentence(`${heading('T')}3.5 is a number. Next.`)).toBe('3.5 is a number.')
    expect(openingSentence(`${heading('T')}Plan a. Next step.`)).toBe('Plan a.')
    expect(openingSentence(`${heading('T')}Wait . Next.`)).toBe('Wait .')
    expect(openingSentence(`${heading('T')}aaa\nMore. Text.`)).toBe('aaa More.')
    expect(openingSentence(`${heading('T')}---x\nMore. Text.`)).toBe('---x More.')
  })

  it('takes nine digits and a period for a list marker but not ten', () => {
    expect(openingSentence(`${heading('T')}123456789. Item. More.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}_ _ _\nText here. More.`)).toBeUndefined()
  })

  it('masks a wikilink that opens right after another, and does not mask from a stray closing bracket', () => {
    expect(openingSentence(`${heading('T')}See [[a]][[b. C]] now. Next.`)).toBe('See [[a]][[b. C]] now.')
    expect(openingSentence(`${heading('T')}Item [a] b. C (see) now. Next.`)).toBe('Item [a] b.')
  })

  it('omits a sentence that runs past 200 characters once its closing marks are counted', () => {
    expect(openingSentence(`${heading('T')}${'a'.repeat(199)}.") Next.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}${'a'.repeat(197)}.") Next.`)).toBe(`${'a'.repeat(197)}.")`)
  })

  it('matches a code span by the length of its fence', () => {
    expect(openingSentence(`${heading('T')}Run \`\`a ` + '`' + `b. c\`\` now. Next.`)).toBe('Run ``a `b. c`` now.')
  })

  it('allows up to three spaces of indentation on the paragraph', () => {
    expect(openingSentence(`${heading('T')}   Indented a little. More.`)).toBe('Indented a little.')
  })

  it('accepts a sentence of exactly 200 characters', () => {
    const sentence = `${'a'.repeat(199)}.`
    expect(sentence).toHaveLength(200)
    expect(openingSentence(`${heading('T')}${sentence} Next.`)).toBe(sentence)
  })
})

describe('openingSentence: the pages that have none', () => {
  it.each([
    ['a sub-heading follows the top heading', '# Topic\n\n## 2026-11-14 (note)\n\nSome text.'],
    ['an ATX heading follows without a blank line', '# Topic\n## Sub\nSome text.'],
    ['the first line is not a top heading', 'Just a sentence.'],
    ['the first line is a second-level heading', '## Topic\n\nSome text.'],
    ['the top heading has no space after the hash', '#Topic\n\nSome text.'],
    ['the heading is a setext heading', 'Topic\n=====\n\nSome text.'],
    ['the body is empty', ''],
    ['the heading has no paragraph', '# Topic\n\n\n'],
    ['the paragraph is a dash list', '# Topic\n\n- one. two.\n- three.'],
    ['the paragraph is a star list', '# Topic\n\n* one.\n* two.'],
    ['the paragraph is a plus list', '# Topic\n\n+ one.\n+ two.'],
    ['the paragraph is a numbered list', '# Topic\n\n1. one.\n2. two.'],
    ['the paragraph is a parenthesised numbered list', '# Topic\n\n1) one.\n2) two.'],
    ['the paragraph is a table', '# Topic\n\n| a | b |\n| - | - |'],
    ['the paragraph is a quote', '# Topic\n\n> Quoted. Text.'],
    ['the paragraph is a backtick fence', '# Topic\n\n```ts\ncode.\n```'],
    ['the paragraph is a tilde fence', '# Topic\n\n~~~\ncode.\n~~~'],
    ['the paragraph is HTML', '# Topic\n\n<div>Hello.</div>'],
    ['the paragraph is indented by a tab', '# Topic\n\n\tcode here.'],
    ['the paragraph is indented by four spaces', '# Topic\n\n    code here.'],
    ['the paragraph is a thematic break', '# Topic\n\n---\n\nText.'],
    ['the paragraph is a heading', '# Topic\n\n### Deep\n\nText.'],
    ['the paragraph ends in a colon', '# Topic\n\nIt contains:\n- a\n- b'],
    ['the paragraph has no terminator', '# Topic\n\nNo terminator here'],
    ['the terminator is not followed by a capital', '# Topic\n\nNo capital follows. then more'],
    ['the paragraph holds no letter or digit', '# Topic\n\n... !!!'],
    ['a thematic break of dashes opens the paragraph', '# Topic\n\n---\nText here. More.'],
    ['a thematic break of stars opens the paragraph', '# Topic\n\n***\nText here. More.'],
    ['a thematic break of underscores opens the paragraph', '# Topic\n\n___\nText here. More.'],
    ['a setext underline opens the paragraph', '# Topic\n\n===\nText here. More.'],
    ['a spaced thematic break opens the paragraph', '# Topic\n\n- - -\nText here. More.'],
    ['a list marker is followed by a tab', '# Topic\n\n-\titem. Next.'],
    ['a numbered list marker is followed by a tab', '# Topic\n\n1.\titem. Next.'],
    ['a dash stands alone on its line', '# Topic\n\n-\nText here. More.'],
    ['a quote is indented by three spaces', '# Topic\n\n   > Quoted. Text.'],
    ['a table is indented by three spaces', '# Topic\n\n   | a | b. C |'],
    ['a tilde fence is indented by three spaces', '# Topic\n\n   ~~~\ncode. More.'],
    ['an HTML line follows', '# Topic\n\n<br>Text here. More.'],
    ['a line of spaces follows the heading and then a heading', '# Topic\n  \n## Sub\nText here. More.'],
  ])('%s', (_name, body) => {
    expect(openingSentence(body)).toBeUndefined()
  })

  it('skips a line of spaces between the heading and the paragraph', () => {
    expect(openingSentence('# Topic\n  \nText here. More.')).toBe('Text here.')
  })

  it('does not take two dashes for a thematic break', () => {
    expect(openingSentence('# Topic\n\n--\nText here. More.')).toBe('-- Text here.')
  })

  it('omits a sentence over 200 characters instead of cutting it', () => {
    expect(openingSentence(`${heading('T')}${'a'.repeat(200)}. Next.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}${'word '.repeat(60)}end.`)).toBeUndefined()
  })

  it('omits a sentence whose masked region runs past the limit', () => {
    expect(openingSentence(`${heading('T')}Run \`${'a'.repeat(300)}\` now. Next.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}Link [x](${'a'.repeat(300)}) now. Next.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}Link [[${'a'.repeat(300)}]] now. Next.`)).toBeUndefined()
    expect(openingSentence(`${heading('T')}Go https://x.io/${'a'.repeat(300)} now. Next.`)).toBeUndefined()
  })
})

describe('oneLine', () => {
  it('turns every control character and line break into a space and collapses runs of spaces', () => {
    expect(oneLine('a\nb\r\nc\td\u0000e\u001Bf\u007Fg\u0085h\u2028i\u2029j   k')).toBe('a b c d e f g h i j k')
  })

  it('replaces the controls at both ends of the C1 range', () => {
    expect(oneLine('a\u007Fb\u009Fc\u00A0d')).toBe('a b c\u00A0d')
  })

  it('trims both ends', () => {
    expect(oneLine('  \n x \t ')).toBe('x')
  })

  it('replaces angle brackets and the field separator', () => {
    expect(oneLine('</wiki_context> a | b <c>')).toBe('(/wiki_context) a / b (c)')
  })

  it('is empty for text of nothing but spaces and controls', () => {
    expect(oneLine(' \n\t\u0000 ')).toBe('')
  })

  it('keeps multi-byte text', () => {
    expect(oneLine('日本語 é')).toBe('日本語 é')
  })
})

describe('assembleWikiIndex: the lines', () => {
  it('lists pages in type order, then path order, each with path, title, type and sentence', () => {
    const result = assemble({
      'knowledge/wiki/topics/vitest.md': page('Vitest', 'topic', `${heading('Vitest')}Vitest is a runner. More.`),
      'knowledge/wiki/repos/fro-bot--agent.md': page('Fro Bot Agent', 'repo', `${heading('Agent')}An action harness.`),
      'knowledge/wiki/entities/octokit.md': page('Octokit', 'entity', `${heading('Octokit')}A client.`),
    })

    expect(result?.index).toBe(
      [
        countLine(3, 3),
        'knowledge/wiki/entities/octokit.md | Octokit | entity | A client.',
        'knowledge/wiki/repos/fro-bot--agent.md | Fro Bot Agent | repo | An action harness.',
        'knowledge/wiki/topics/vitest.md | Vitest | topic | Vitest is a runner.',
      ].join('\n'),
    )
    expect(result).toMatchObject({listed: 3, held: 3, sentences: 'kept', incomplete: false})
  })

  it('lists an archived page with its notice as the sentence', () => {
    const result = assemble({
      'knowledge/wiki/repos/example-org--lantern.md': page(
        'Example Lantern',
        'repo',
        `${heading('Example Lantern')}${ARCHIVE_NOTICE}\n\nSurvey notes. More.`,
        'archived: 2026-11-16',
      ),
    })

    expect(result?.index.split('\n').slice(1)).toEqual([
      `knowledge/wiki/repos/example-org--lantern.md | Example Lantern | repo | ${ARCHIVE_NOTICE}`,
    ])
    expect(result).toMatchObject({sentences: 'kept'})
  })

  it('orders by the type the page names, not by its directory', () => {
    const result = assemble({
      'knowledge/wiki/repos/a.md': page('A', 'topic', 'x'),
      'knowledge/wiki/topics/b.md': page('B', 'repo', 'x'),
    })

    expect(result?.index.split('\n').slice(1)).toEqual([
      'knowledge/wiki/topics/b.md | B | repo',
      'knowledge/wiki/repos/a.md | A | topic',
    ])
  })

  it('orders by code unit within a type, and by type name across types', () => {
    const result = assemble({
      'knowledge/wiki/topics/b.md': page('B', 'topic', 'x'),
      'knowledge/wiki/topics/B.md': page('Upper B', 'topic', 'x'),
      'knowledge/wiki/topics/a.md': page('A', 'topic', 'x'),
      'knowledge/wiki/comparisons/z.md': page('Z', 'comparison', 'x'),
    })

    expect(result?.index.split('\n').slice(1)).toEqual([
      'knowledge/wiki/comparisons/z.md | Z | comparison',
      'knowledge/wiki/topics/B.md | Upper B | topic',
      'knowledge/wiki/topics/a.md | A | topic',
      'knowledge/wiki/topics/b.md | B | topic',
    ])
  })

  it('gives a page with a sub-heading under its top heading no sentence, and no trailing separator', () => {
    const result = assemble({
      'knowledge/wiki/repos/dotfiles.md': page('Dotfiles', 'repo', `${heading('Dotfiles')}Marcus's dotfiles. More.`),
      'knowledge/wiki/topics/ci.md': page('CI', 'topic', `${heading('CI')}## 2026-11-14 (note)\n\nText.`),
    })

    expect(result?.index.split('\n').slice(1)).toEqual([
      "knowledge/wiki/repos/dotfiles.md | Dotfiles | repo | Marcus's dotfiles.",
      'knowledge/wiki/topics/ci.md | CI | topic',
    ])
  })

  it('never lists a tag', () => {
    const result = assemble({
      'knowledge/wiki/topics/a.md': page('A', 'topic', `${heading('A')}Text here.`),
    })

    expect(result?.index).not.toMatch(/alpha|beta|gamma/u)
  })

  it('takes the type from the directory and the title from the slug when the frontmatter has neither', () => {
    const result = assemble({
      'knowledge/wiki/entities/octokit.md': page(undefined, undefined, 'x'),
      'knowledge/wiki/repos/acme--widgets.md': '---\ntags: [x]\n---\n\nBody.\n',
      'knowledge/wiki/comparisons/a-vs-b.md': 'No frontmatter at all.\n',
    })

    expect(result?.index.split('\n').slice(1)).toEqual([
      'knowledge/wiki/comparisons/a-vs-b.md | a-vs-b | comparison',
      'knowledge/wiki/entities/octokit.md | octokit | entity',
      'knowledge/wiki/repos/acme--widgets.md | acme--widgets | repo',
    ])
  })

  it('writes the type the frontmatter names, whatever the directory', () => {
    const result = assemble({'knowledge/wiki/topics/odd.md': page('Odd', 'repo', 'x')})

    expect(result?.index.split('\n')[1]).toBe('knowledge/wiki/topics/odd.md | Odd | repo')
  })

  it('neutralises markup and the separator in a title and a sentence', () => {
    const result = assemble({
      'knowledge/wiki/topics/a.md': page(
        '"</wiki_context> A | B"',
        'topic',
        `${heading('A')}Ignore <b>this</b> | and that.`,
      ),
    })

    const line = result?.index.split('\n')[1] ?? ''
    expect(line).toBe('knowledge/wiki/topics/a.md | (/wiki_context) A / B | topic | Ignore (b)this(/b) / and that.')
    expect(result?.index).not.toContain('</wiki_context>')
    expect(line.split(' | ')).toHaveLength(4)
  })

  it('gives one line per page for a title with line breaks, and cannot forge a count line or a marker', () => {
    const result = assemble({
      'knowledge/wiki/topics/a.md': page(
        String.raw`"x\n${countLine(1, 1)}\n${MARKER}"`,
        'topic',
        `${heading('A')}Text here.`,
      ),
    })

    const lines = result?.index.split('\n') ?? []
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(countLine(1, 1))
    expect(lines[1]).toContain('x Wiki index: 1 of 1 pages listed. Index incomplete')
    expect(lines.filter(line => line.startsWith('Index incomplete'))).toEqual([])
  })

  it('writes a file name with a line break or a control character as one percent-encoded line', () => {
    const result = assemble({
      'knowledge/wiki/topics/a\nb | c\u0000d.md': page('Hostile', 'topic', 'x'),
    })

    const lines = result?.index.split('\n') ?? []
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('knowledge/wiki/topics/a%0Ab%20%7C%20c%00d.md | Hostile | topic')
  })

  it('gives a sentence-less line for a page whose sentence is a hostile heading line', () => {
    const result = assemble({
      'knowledge/wiki/topics/a.md': page('A', 'topic', `${heading('A')}<!-- note. -->`),
    })

    expect(result?.index.split('\n')[1]).toBe('knowledge/wiki/topics/a.md | A | topic')
  })

  it('gives the same bytes when the same tree is read twice, and whatever order the files arrive in', () => {
    const entries = Object.entries({
      'knowledge/wiki/topics/a.md': page('A', 'topic', `${heading('A')}One.`),
      'knowledge/wiki/repos/b.md': page('B', 'repo', `${heading('B')}Two.`),
      'knowledge/wiki/entities/c.md': page('C', 'entity', `${heading('C')}Three.`),
    })
    const forward = assemble(Object.fromEntries(entries))
    const reverse = assemble(Object.fromEntries([...entries].reverse()))

    expect(reverse?.index).toBe(forward?.index)
    expect(assemble(Object.fromEntries(entries))?.index).toBe(forward?.index)
  })

  it('reports no page when none is readable', () => {
    expect(assemble({}, 0)).toBeUndefined()
    expect(assemble({'knowledge/wiki/topics/a.md': '---\ntitle: [x\n---\n\nBody.'}, 1)).toBeUndefined()
  })
})

describe('assembleWikiIndex: the pages it skips', () => {
  const GOOD = {
    'knowledge/wiki/topics/a.md': page('A', 'topic', 'x'),
    'knowledge/wiki/topics/b.md': page('B', 'topic', 'x'),
  }

  it('skips unclosed and invalid frontmatter with a closed reason, lists the rest, and counts both in held', () => {
    const result = assembleWikiIndex({
      files: {
        ...GOOD,
        'knowledge/wiki/topics/unclosed.md': '---\ntype: topic\ntitle: Bad\n\nBody.\n',
        'knowledge/wiki/topics/invalid.md': '---\ntype: topic\ntitle: [oops\n---\n\nBody.\n',
      },
      held: 4,
      unreadable: [],
    })

    expect(result).toMatchObject({listed: 2, held: 4, skipped: 2})
    expect(result?.index.split('\n')[0]).toBe(countLine(2, 4, 2))
    expect(result?.skippedPages).toEqual([
      {path: 'knowledge/wiki/topics/invalid.md', reason: 'invalid-frontmatter'},
      {path: 'knowledge/wiki/topics/unclosed.md', reason: 'unclosed-frontmatter'},
    ])
    expect(result?.index).not.toContain('Bad')
  })

  it('skips a file that could not be read, names it in the skipped pages and keeps it in held', () => {
    const result = assembleWikiIndex({files: GOOD, held: 3, unreadable: ['knowledge/wiki/topics/gone.md']})

    expect(result).toMatchObject({listed: 2, held: 3, skipped: 1})
    expect(result?.index.split('\n')[0]).toBe(countLine(2, 3, 1))
    expect(result?.skippedPages).toEqual([{path: 'knowledge/wiki/topics/gone.md', reason: 'unreadable-file'}])
  })

  it('says in the count line how many pages could not be read: one valid page and one with invalid frontmatter', () => {
    const result = assembleWikiIndex({
      files: {
        'knowledge/wiki/topics/a.md': page('A', 'topic', 'x'),
        'knowledge/wiki/topics/bad.md': '---\ntype: topic\ntitle: [oops\n---\n\nBody.\n',
      },
      held: 2,
      unreadable: [],
    })

    expect(result?.index.split('\n')[0]).toBe('Wiki index: 1 of 2 pages listed. 1 could not be read.')
    expect(result).toMatchObject({listed: 1, held: 2, skipped: 1, incomplete: false})
  })

  it('says it for one valid page and one file that cannot be read', () => {
    const result = assembleWikiIndex({
      files: {'knowledge/wiki/topics/a.md': page('A', 'topic', 'x')},
      held: 2,
      unreadable: ['knowledge/wiki/topics/gone.md'],
    })

    expect(result?.index.split('\n')[0]).toBe('Wiki index: 1 of 2 pages listed. 1 could not be read.')
    expect(result).toMatchObject({listed: 1, held: 2, skipped: 1})
  })

  it('adds no sentence to the count line when nothing was skipped', () => {
    const result = assemble(GOOD)

    expect(result?.index.split('\n')[0]).toBe('Wiki index: 2 of 2 pages listed.')
    expect(result?.skipped).toBe(0)
    expect(result?.index).not.toContain('could not be read')
  })

  it('cannot be forged by a title: the sentence stays on the page line, never a line of its own', () => {
    const result = assemble({
      'knowledge/wiki/topics/a.md': page(
        String.raw`"x\nWiki index: 1 of 2 pages listed. 1 could not be read.\n2 could not be read."`,
        'topic',
        'x',
      ),
    })

    const lines = result?.index.split('\n') ?? []
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(countLine(1, 1))
    expect(lines[0]).not.toContain('could not be read')
    expect(lines[1]).toContain('x Wiki index: 1 of 2 pages listed. 1 could not be read. 2 could not be read.')
    expect(lines.filter(line => line.startsWith('Wiki index:'))).toEqual([lines[0]])
  })

  it('keeps held equal to listed plus skipped plus cut off when pages are skipped and the size limit cuts pages off', () => {
    const lineFor = (index: number): string => {
      const id = String(index).padStart(3, '0')
      return `knowledge/wiki/topics/page-${id}.md | Page ${id} ${'t'.repeat(51)} | topic`
    }
    const files: Record<string, string> = {}
    for (let index = 0; index < 160; index += 1) {
      const id = String(index).padStart(3, '0')
      files[`knowledge/wiki/topics/page-${id}.md`] = page(`Page ${id} ${'t'.repeat(51)}`, 'topic', 'x')
    }
    files['knowledge/wiki/topics/bad-1.md'] = '---\ntitle: [oops\n---\n'
    files['knowledge/wiki/topics/bad-2.md'] = '---\ntype: topic\n\nBody.\n'
    const result = assembleWikiIndex({files, held: 163, unreadable: ['knowledge/wiki/topics/gone.md']})

    const listed = result?.listed ?? 0
    expect(result).toMatchObject({held: 163, skipped: 3, incomplete: true, sentences: 'dropped'})
    expect(listed).toBeGreaterThan(0)
    expect(163 - listed - 3).toBeGreaterThan(0)
    const render = (count: number): string =>
      [countLine(count, 163, 3), ...Array.from({length: count}, (_, index) => lineFor(index)), MARKER].join('\n')
    expect(result?.index).toBe(render(listed))
    expect(Buffer.byteLength(render(listed))).toBeLessThanOrEqual(MAX_INDEX_BYTES)
    expect(Buffer.byteLength(render(listed + 1))).toBeGreaterThan(MAX_INDEX_BYTES)
    expect(result?.bytes).toBe(Buffer.byteLength(render(listed)))
  })

  it('reads a page that starts with a byte order mark: its title and sentence are kept', () => {
    const result = assemble({
      'knowledge/wiki/repos/bom.md': `\uFEFF${page('Bom Page', 'repo', `${heading('Bom Page')}A sentence follows.`)}`,
    })

    expect(result?.index.split('\n')[1]).toBe('knowledge/wiki/repos/bom.md | Bom Page | repo | A sentence follows.')
    expect(result?.skipped).toBe(0)
  })

  it('sorts the skipped pages by path whatever their reason', () => {
    const result = assembleWikiIndex({
      files: {...GOOD, 'knowledge/wiki/topics/m.md': '---\ntitle: [x\n---\n'},
      held: 5,
      unreadable: ['knowledge/wiki/topics/z.md', 'knowledge/wiki/topics/a-first.md'],
    })

    expect(result?.skippedPages.map(skipped => skipped.path)).toEqual([
      'knowledge/wiki/topics/a-first.md',
      'knowledge/wiki/topics/m.md',
      'knowledge/wiki/topics/z.md',
    ])
  })
})

describe('assembleWikiIndex: the size limit', () => {
  const SENTENCE = 'A sentence that is eighty characters long, give or take a few, for the size tests.'

  /** `count` pages whose title is `titleLength` characters, each with an opening sentence. */
  function tree(count: number, titleLength: number): Record<string, string> {
    const files: Record<string, string> = {}
    for (let index = 0; index < count; index += 1) {
      const id = String(index).padStart(3, '0')
      const title = `Page ${id} ${'t'.repeat(Math.max(0, titleLength - 9))}`
      files[`knowledge/wiki/topics/page-${id}.md`] = page(title, 'topic', `${heading(title)}${SENTENCE}`)
    }
    return files
  }

  const entryLine = (files: Record<string, string>, path: string, withSentence: boolean): string => {
    const title = /title: (.*)\n/u.exec(files[path] ?? '')?.[1] ?? ''
    return `${path} | ${title} | topic${withSentence ? ` | ${SENTENCE}` : ''}`
  }

  it('is 12 KiB', () => {
    expect(MAX_INDEX_BYTES).toBe(12 * 1024)
  })

  it('keeps every sentence while the whole index fits', () => {
    const files = tree(40, 60)
    const result = assemble(files)

    expect(result).toMatchObject({listed: 40, held: 40, sentences: 'kept', incomplete: false})
    expect(
      result?.index
        .split('\n')
        .slice(1)
        .every(line => line.endsWith(SENTENCE)),
    ).toBe(true)
    expect(result?.bytes).toBe(Buffer.byteLength(result?.index ?? '', 'utf8'))
    expect(result?.bytes).toBeLessThanOrEqual(MAX_INDEX_BYTES)
  })

  it('drops every sentence, lists every page and keeps the counts equal when only the sentences push it over (AE4)', () => {
    const files = tree(100, 60)
    const paths = Object.keys(files).toSorted()
    const withSentences = [countLine(100, 100), ...paths.map(path => entryLine(files, path, true))].join('\n')
    const without = [countLine(100, 100), ...paths.map(path => entryLine(files, path, false))].join('\n')
    expect(Buffer.byteLength(withSentences)).toBeGreaterThan(MAX_INDEX_BYTES)
    expect(Buffer.byteLength(without)).toBeLessThanOrEqual(MAX_INDEX_BYTES)

    const result = assemble(files)

    expect(result).toMatchObject({listed: 100, held: 100, sentences: 'dropped', incomplete: false})
    expect(result?.index).toBe(without)
    expect(result?.bytes).toBe(Buffer.byteLength(without))
  })

  it('lists the pages that fit, in order, and says it is incomplete when even the bare lines do not fit (AE5)', () => {
    const files = tree(160, 60)
    const paths = Object.keys(files).toSorted()

    const result = assemble(files)

    expect(result?.sentences).toBe('dropped')
    expect(result?.incomplete).toBe(true)
    expect(result?.held).toBe(160)
    const listed = result?.listed ?? 0
    expect(listed).toBeGreaterThan(0)
    expect(listed).toBeLessThan(160)
    const lines = result?.index.split('\n') ?? []
    expect(lines[0]).toBe(countLine(listed, 160))
    expect(lines.at(-1)).toBe(MARKER)
    expect(lines.slice(1, -1)).toEqual(paths.slice(0, listed).map(path => entryLine(files, path, false)))
    expect(result?.bytes).toBe(Buffer.byteLength(result?.index ?? ''))
    expect(result?.bytes).toBeLessThanOrEqual(MAX_INDEX_BYTES)
  })

  it.each(Array.from({length: 41}, (_, index) => index))(
    'admits as many lines as fit, whichever way the count width falls: title padding %i',
    padding => {
      const files = tree(150, 50 + padding)
      const paths = Object.keys(files).toSorted()
      const render = (count: number): string =>
        [countLine(count, 150), ...paths.slice(0, count).map(path => entryLine(files, path, false)), MARKER].join('\n')

      const result = assemble(files)

      const listed = result?.listed ?? 0
      expect(result?.incomplete).toBe(true)
      expect(result?.index).toBe(render(listed))
      expect(Buffer.byteLength(render(listed))).toBeLessThanOrEqual(MAX_INDEX_BYTES)
      expect(Buffer.byteLength(render(listed + 1))).toBeGreaterThan(MAX_INDEX_BYTES)
    },
  )

  describe('at the exact limit', () => {
    const bare = (path: string, title: string): string => `${path} | ${title} | topic`
    const pathOf = (index: number): string => `knowledge/wiki/topics/page-${String(index).padStart(3, '0')}.md`
    const titleOf = (index: number, pad: number): string =>
      `Page ${String(index).padStart(3, '0')} ${'t'.repeat(60)}${'t'.repeat(pad)}`

    /** `count` pages with one title padded at `padIndex`; with a sentence on every page when `sentence` is set. */
    function treeOf(count: number, padIndex: number, pad: number, sentence: boolean): Record<string, string> {
      const files: Record<string, string> = {}
      for (let index = 0; index < count; index += 1) {
        const title = titleOf(index, index === padIndex ? pad : 0)
        files[pathOf(index)] = page(title, 'topic', sentence ? `${heading(title)}${SENTENCE}` : 'x')
      }
      return files
    }

    const render = (count: number, held: number, padIndex: number, pad: number, tail: string[]): string =>
      [
        countLine(count, held),
        ...Array.from({length: count}, (_, index) => bare(pathOf(index), titleOf(index, index === padIndex ? pad : 0))),
        ...tail,
      ].join('\n')

    it('keeps the sentences when the whole index is exactly 12 KiB, and drops them one byte over', () => {
      const unpadded = [
        countLine(50, 50),
        ...Array.from({length: 50}, (_, index) => `${bare(pathOf(index), titleOf(index, 0))} | ${SENTENCE}`),
      ].join('\n')
      const pad = MAX_INDEX_BYTES - Buffer.byteLength(unpadded)
      expect(pad).toBeGreaterThan(0)

      const exact = assemble(treeOf(50, 49, pad, true))
      const over = assemble(treeOf(50, 49, pad + 1, true))

      expect(exact).toMatchObject({sentences: 'kept', incomplete: false, bytes: MAX_INDEX_BYTES, listed: 50})
      expect(over).toMatchObject({sentences: 'dropped', incomplete: false, listed: 50})
    })

    it('lists every page when the bare index is exactly 12 KiB, and says it is incomplete one byte over', () => {
      const pad = MAX_INDEX_BYTES - Buffer.byteLength(render(100, 100, 99, 0, []))
      expect(pad).toBeGreaterThan(0)

      const exact = assemble(treeOf(100, 99, pad, false))
      const over = assemble(treeOf(100, 99, pad + 1, false))

      expect(exact).toMatchObject({sentences: 'kept', incomplete: false, bytes: MAX_INDEX_BYTES, listed: 100})
      expect(over).toMatchObject({sentences: 'dropped', incomplete: true})
      expect(over?.listed).toBeLessThan(100)
      expect(over?.bytes).toBeLessThanOrEqual(MAX_INDEX_BYTES)
    })

    it('admits a line that makes the index exactly 12 KiB with its marker, whatever the width of the count', () => {
      const pad = MAX_INDEX_BYTES - Buffer.byteLength(render(100, 150, 99, 0, [MARKER]))
      expect(pad).toBeGreaterThan(0)

      const exact = assemble(treeOf(150, 99, pad, false))
      const over = assemble(treeOf(150, 99, pad + 1, false))

      expect(exact).toMatchObject({listed: 100, incomplete: true, bytes: MAX_INDEX_BYTES})
      expect(exact?.index).toBe(render(100, 150, 99, pad, [MARKER]))
      expect(over).toMatchObject({listed: 99, incomplete: true})
      expect(over?.index).toBe(render(99, 150, 99, pad + 1, [MARKER]))
      expect(over?.bytes).toBeLessThanOrEqual(MAX_INDEX_BYTES)
    })
  })

  it('counts bytes, not characters, for multi-byte titles', () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 120; index += 1) {
      const id = String(index).padStart(3, '0')
      files[`knowledge/wiki/topics/p-${id}.md`] = page(`日本語のタイトル${'é'.repeat(30)} ${id}`, 'topic', 'x')
    }

    const result = assemble(files)

    expect(Buffer.byteLength(result?.index ?? '')).toBeLessThanOrEqual(MAX_INDEX_BYTES)
    expect(result?.incomplete).toBe(true)
    expect(result?.index.length).toBeLessThan(MAX_INDEX_BYTES)
    expect(result?.bytes).toBe(Buffer.byteLength(result?.index ?? ''))
  })
})

describe('statusLine', () => {
  const base = {
    index: '',
    listed: 48,
    held: 48,
    sentences: 'kept',
    incomplete: false,
    bytes: 7436,
    skipped: 0,
    skippedPages: [],
  } as const

  it('names every count and word of a full index with its sentences', () => {
    expect(statusLine(base)).toBe('wiki-index: listed=48 held=48 skipped=0 sentences=kept bytes=7436')
  })

  it('says when the sentences were dropped', () => {
    expect(statusLine({...base, sentences: 'dropped', bytes: 3900})).toBe(
      'wiki-index: listed=48 held=48 skipped=0 sentences=dropped bytes=3900',
    )
  })

  it('says when the index is incomplete', () => {
    expect(statusLine({...base, listed: 40, sentences: 'dropped', incomplete: true, bytes: 12_288})).toBe(
      'wiki-index: listed=40 held=48 skipped=0 sentences=dropped incomplete bytes=12288',
    )
  })

  it('says how many pages were skipped, alone and together with an incomplete index', () => {
    expect(statusLine({...base, listed: 47, skipped: 1})).toBe(
      'wiki-index: listed=47 held=48 skipped=1 sentences=kept bytes=7436',
    )
    expect(statusLine({...base, listed: 30, skipped: 3, sentences: 'dropped', incomplete: true, bytes: 12_000})).toBe(
      'wiki-index: listed=30 held=48 skipped=3 sentences=dropped incomplete bytes=12000',
    )
  })

  it('says unavailable and nothing else when there is no index', () => {
    expect(statusLine(undefined)).toBe('wiki-index: unavailable')
  })

  it('holds integers and fixed words only', () => {
    expect(statusLine(base)).toMatch(
      /^wiki-index: listed=\d+ held=\d+ skipped=\d+ sentences=(?:kept|dropped)(?: incomplete)? bytes=\d+$/u,
    )
  })
})

// ─── runWikiIndex ────────────────────────────────────────────────────────────────────────────────

interface FakeOptions {
  readonly emptyDirs?: readonly string[]
  readonly unlistable?: readonly string[]
  readonly unreadable?: readonly string[]
}

function errorWithCode(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), {code})
}

/** An in-memory checkout: a directory exists when a file sits somewhere beneath it, or it is named in `emptyDirs`. */
function fakeFs(
  files: Readonly<Record<string, string>>,
  options: FakeOptions = {},
): {fs: WikiIndexFs; reads: string[]} {
  const reads: string[] = []
  const fs: WikiIndexFs = {
    readDir: async path => {
      if (options.unlistable?.includes(path) === true) throw errorWithCode('EACCES', path)
      const prefix = `${path}/`
      const names = new Map<string, boolean>()
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue
        const rest = file.slice(prefix.length)
        const slash = rest.indexOf('/')
        if (slash === -1) names.set(rest, true)
        else names.set(rest.slice(0, slash), false)
      }
      const exists = names.size > 0 || options.emptyDirs?.includes(path) === true
      if (!exists) throw errorWithCode('ENOENT', path)
      return [...names].map(([name, isFile]) => ({name, isFile: () => isFile}))
    },
    readFile: async path => {
      reads.push(path)
      if (options.unreadable?.includes(path) === true) throw errorWithCode('EACCES', path)
      const content = files[path]
      if (content === undefined) throw errorWithCode('ENOENT', path)
      return content
    },
  }
  return {fs, reads}
}

interface Captured {
  readonly io: WikiIndexIo
  readonly stdout: string[]
  readonly stderr: string[]
}

function capture(brokenStderr = false): Captured {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    io: {
      stdout: text => stdout.push(text),
      stderr: text => {
        if (brokenStderr) throw new Error('EPIPE')
        stderr.push(text)
      },
    },
  }
}

function parseOutput(text: string): string | undefined {
  const heredoc = /^index<<(\S+)\n([\s\S]*)\n\1\n$/u.exec(text)
  if (heredoc !== null) return heredoc[2]
  const single = /^index=(.*)\n$/u.exec(text)
  return single === null ? undefined : single[1]
}

interface RunResult extends Captured {
  readonly reads: string[]
  readonly written: string | undefined
  readonly index: string | undefined
}

async function run(
  files: Readonly<Record<string, string>>,
  options: FakeOptions & {brokenStderr?: boolean; withOutput?: boolean} = {},
): Promise<RunResult> {
  const dir = await mkdtemp(join(tmpdir(), 'wiki-index-'))
  const outputPath = options.withOutput === false ? undefined : join(dir, 'github-output.txt')
  const captured = capture(options.brokenStderr === true)
  const {fs, reads} = fakeFs(files, options)
  await runWikiIndex(outputPath === undefined ? {} : {GITHUB_OUTPUT: outputPath}, captured.io, fs)
  const written = outputPath === undefined ? undefined : await readFile(outputPath, 'utf8').catch(() => undefined)
  await rm(dir, {recursive: true, force: true})
  return {...captured, reads, written, index: written === undefined ? undefined : parseOutput(written)}
}

describe('runWikiIndex', () => {
  const TREE = {
    'knowledge/index.md': '# Wiki Index\n',
    'knowledge/wiki/repos/a.md': page('A', 'repo', `${heading('A')}Alpha repo.`),
    'knowledge/wiki/topics/b.md': page('B', 'topic', `${heading('B')}Beta topic.`),
  }

  it('writes the index output and prints the one status line', async () => {
    const result = await run(TREE)

    expect(result.index).toBe(
      [
        countLine(2, 2),
        'knowledge/wiki/repos/a.md | A | repo | Alpha repo.',
        'knowledge/wiki/topics/b.md | B | topic | Beta topic.',
      ].join('\n'),
    )
    expect(result.stdout).toEqual([
      `wiki-index: listed=2 held=2 skipped=0 sentences=kept bytes=${Buffer.byteLength(result.index ?? '')}\n`,
    ])
    expect(result.stderr).toEqual([])
  })

  it('never reads knowledge/index.md, and does not need it', async () => {
    const withIndex = await run(TREE)
    const withoutIndexFile = Object.fromEntries(Object.entries(TREE).filter(([path]) => path !== 'knowledge/index.md'))
    const without = await run(withoutIndexFile)

    expect(withIndex.reads).not.toContain('knowledge/index.md')
    expect(without.index).toBe(withIndex.index)
  })

  it('reads the four wiki directories only, and counts .md files that are files', async () => {
    const result = await run({
      ...TREE,
      'knowledge/wiki/topics/notes.txt': 'not a page',
      'knowledge/wiki/topics/nested/deep.md': page('Deep', 'topic', 'x'),
      'knowledge/wiki/other/c.md': page('C', 'topic', 'x'),
    })

    expect(result.index?.split('\n')[0]).toBe(countLine(2, 2))
    expect(result.reads.toSorted()).toEqual(['knowledge/wiki/repos/a.md', 'knowledge/wiki/topics/b.md'])
  })

  it('gives the same output for any order of the directory listing', async () => {
    const forward = await run(TREE)
    const shuffled = await run(Object.fromEntries(Object.entries(TREE).toReversed()))

    expect(shuffled.index).toBe(forward.index)
  })

  it('treats a missing optional directory beside readable ones as no error', async () => {
    const result = await run({'knowledge/wiki/repos/a.md': TREE['knowledge/wiki/repos/a.md']})

    expect(result.index?.split('\n')[0]).toBe(countLine(1, 1))
    expect(result.stderr).toEqual([])
  })

  it('skips a page with unreadable frontmatter, with an encoded warning naming the reason, and lists the rest', async () => {
    const result = await run({
      ...TREE,
      'knowledge/wiki/topics/unclosed.md': '---\ntype: topic\n\nBody.\n',
      'knowledge/wiki/topics/invalid.md': '---\ntitle: [oops\n---\n\nBody.\n',
    })

    expect(result.stderr).toEqual([
      'wiki-index:warn:page-skipped path="knowledge/wiki/topics/invalid.md" reason=invalid-frontmatter\n',
      'wiki-index:warn:page-skipped path="knowledge/wiki/topics/unclosed.md" reason=unclosed-frontmatter\n',
    ])
    expect(result.index?.split('\n')[0]).toBe(countLine(2, 4, 2))
    expect(result.stdout[0]).toMatch(/^wiki-index: listed=2 held=4 skipped=2 sentences=kept bytes=\d+\n$/u)
  })

  it('skips a file that cannot be read, warns once, counts it in held and still builds the rest', async () => {
    const result = await run(TREE, {unreadable: ['knowledge/wiki/topics/b.md']})

    expect(result.stderr).toEqual([
      'wiki-index:warn:page-skipped path="knowledge/wiki/topics/b.md" reason=unreadable-file\n',
    ])
    expect(result.index?.split('\n')[0]).toBe(countLine(1, 2, 1))
    expect(result.stdout[0]).toMatch(/^wiki-index: listed=1 held=2 skipped=1 sentences=kept bytes=\d+\n$/u)
  })

  it('percent-encodes a hostile file name in the warning', async () => {
    const name = 'x [a](http:evil) <img src=x onerror=1> "q" | é.md'
    const result = await run({...TREE, [`knowledge/wiki/topics/${name}`]: '---\ntitle: [oops\n---\n'})

    const match = /^wiki-index:warn:page-skipped path="([^"]*)" reason=invalid-frontmatter\n$/u.exec(
      result.stderr[0] ?? '',
    )
    expect(match).not.toBeNull()
    expect(match?.[1]).toMatch(/^[\w%./-]+$/u)
    expect(decodeURIComponent(match?.[1] ?? '')).toBe(`knowledge/wiki/topics/${name}`)
  })

  it.each([
    ['a missing wiki root', {'knowledge/index.md': '# Wiki Index\n'}, {}, []],
    ['a wiki root with no pages', {}, {emptyDirs: ['knowledge/wiki', 'knowledge/wiki/repos']}, []],
    ['a wiki root that cannot be listed', TREE, {unlistable: ['knowledge/wiki']}, []],
    ['a directory that cannot be listed', TREE, {unlistable: ['knowledge/wiki/topics']}, []],
    [
      'a tree where no page can be read',
      {'knowledge/wiki/topics/b.md': '---\ntitle: [oops\n---\n'},
      {},
      ['wiki-index:warn:page-skipped path="knowledge/wiki/topics/b.md" reason=invalid-frontmatter\n'],
    ],
    [
      'a tree where every file fails to read',
      TREE,
      {unreadable: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/topics/b.md']},
      [
        'wiki-index:warn:page-skipped path="knowledge/wiki/repos/a.md" reason=unreadable-file\n',
        'wiki-index:warn:page-skipped path="knowledge/wiki/topics/b.md" reason=unreadable-file\n',
      ],
    ],
  ] as const)(
    'gives an empty index output, the unavailable status line and one warning for %s',
    async (_name, files, options, skippedWarnings) => {
      const result = await run(files, options)

      expect(result.index).toBe('')
      expect(result.stdout).toEqual(['wiki-index: unavailable\n'])
      expect(result.stderr).toEqual([...skippedWarnings, 'wiki-index:warn:index-unavailable\n'])
    },
  )

  it('gives the unavailable index when reading the checkout fails in a way nobody planned for', async () => {
    const captured = capture()
    const fs: WikiIndexFs = {
      readDir: async path =>
        path === 'knowledge/wiki/repos'
          ? [
              {
                name: 'a.md',
                isFile: () => {
                  throw new Error('boom')
                },
              },
            ]
          : [],
      readFile: async () => '',
    }
    const dir = await mkdtemp(join(tmpdir(), 'wiki-index-'))
    try {
      await runWikiIndex({GITHUB_OUTPUT: join(dir, 'out.txt')}, captured.io, fs)
      expect(parseOutput(await readFile(join(dir, 'out.txt'), 'utf8'))).toBe('')
    } finally {
      await rm(dir, {recursive: true, force: true})
    }

    expect(captured.stdout).toEqual(['wiki-index: unavailable\n'])
    expect(captured.stderr).toEqual(['wiki-index:warn:index-unavailable\n'])
  })

  it('does not stop the output or the status line when stderr is closed', async () => {
    const result = await run(
      {...TREE, 'knowledge/wiki/topics/unclosed.md': '---\ntype: topic\n\nBody.\n'},
      {brokenStderr: true},
    )

    expect(result.index?.split('\n')[0]).toBe(countLine(2, 3, 1))
    expect(result.stdout).toHaveLength(1)
    const unavailable = await run({}, {brokenStderr: true})
    expect(unavailable.index).toBe('')
    expect(unavailable.stdout).toEqual(['wiki-index: unavailable\n'])
  })

  it('prints the status line and writes nothing when there is no output file', async () => {
    const result = await run(TREE, {withOutput: false})

    expect(result.written).toBeUndefined()
    expect(result.stdout).toHaveLength(1)
  })

  it('works against the real file system', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-index-real-'))
    const previous = process.cwd()
    try {
      await mkdir(join(root, 'knowledge/wiki/repos'), {recursive: true})
      await writeFile(join(root, 'knowledge/wiki/repos/a.md'), TREE['knowledge/wiki/repos/a.md'])
      process.chdir(root)
      const captured = capture()
      await runWikiIndex({}, captured.io)
      expect(captured.stdout[0]).toMatch(/^wiki-index: listed=1 held=1 skipped=0 sentences=kept bytes=\d+\n$/u)
    } finally {
      process.chdir(previous)
      await rm(root, {recursive: true, force: true})
    }
  })
})
