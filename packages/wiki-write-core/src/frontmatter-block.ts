/**
 * What `splitFrontmatterBlock` found at the start of a document.
 *
 * - `none`: the content does not open a block.
 * - `malformed`: the content opens a block and never closes it. It carries no content, so a caller cannot read
 *   the pieces of a block that was not closed.
 * - `block`: the content opens and closes a block. The five strings put the content back byte for byte:
 *   `opening + text + textEnding + closing + body` is the original content.
 *
 * The pieces are strings, not offsets, so an editor that rewrites a line of the block rebuilds the file from the
 * result alone, with the line endings, trailing spaces and body it found.
 */
export type FrontmatterBlockSplit =
  | {readonly kind: 'none'}
  | {readonly kind: 'malformed'}
  | {
      readonly kind: 'block'
      /** The opening line with its line ending: `---` and LF or CRLF. */
      readonly opening: string
      /**
       * The lines between the opening and the closing line, each with the line ending it has, except the last line,
       * whose ending is `textEnding`. It is what a YAML parser reads. It is `''` for a block with no lines and for
       * a block of one blank line, which `textEnding` tells apart.
       */
      readonly text: string
      /** The line ending of the last line of `text`: `\n`, `\r\n`, or `''` when the block has no lines. */
      readonly textEnding: string
      /** The closing line: `---`, any spaces or tabs after it, and its line ending. It has none at the end of the content. */
      readonly closing: string
      /** Everything after the closing line, untouched. */
      readonly body: string
    }

/**
 * Finds the YAML frontmatter block at the start of `content`. It does not parse the YAML.
 *
 * The block rule:
 * - The content starts with a line that is exactly `---`. A space, a byte-order mark, a blank line or any other
 *   character before it or after it, on that line, means there is no block.
 * - A line ending is LF or CRLF. A lone CR is part of its line.
 * - The block ends at the first later line that is `---` followed only by spaces or tabs. A line such as `---x`,
 *   `----` or `--- text` is part of the block.
 * - A block can be empty: `---` directly followed by `---` gives empty text.
 * - A block that is opened and never closed is malformed, and so is a file that is only `---`.
 *
 * The scan visits each line once and never goes back, so its running time is linear in the length of the content.
 */
export function splitFrontmatterBlock(content: string): FrontmatterBlockSplit {
  const first = scanLine(content, 0)
  if (first.end !== 3 || !content.startsWith('---')) return {kind: 'none'}

  // `textEnd` is the end of the last line that is not the close, before its line ending. A file that is only the
  // opening line has no next line, so the loop does not run and the block is malformed.
  let textEnd = first.next
  let at = first.next
  while (at < content.length) {
    const line = scanLine(content, at)
    if (isCloseLine(content, at, line.end)) {
      return {
        kind: 'block',
        opening: content.slice(0, first.next),
        text: content.slice(first.next, textEnd),
        textEnding: content.slice(textEnd, at),
        closing: content.slice(at, line.next),
        body: content.slice(line.next),
      }
    }
    textEnd = line.end
    at = line.next
  }
  return {kind: 'malformed'}
}

interface ScannedLine {
  /** The offset just past the last character of the line, before its line ending. */
  readonly end: number
  /** The offset of the next line, or the length of the content. */
  readonly next: number
}

function scanLine(content: string, start: number): ScannedLine {
  const feed = content.indexOf('\n', start)
  if (feed === -1) return {end: content.length, next: content.length}
  if (content.charAt(feed - 1) === '\r') return {end: feed - 1, next: feed + 1}
  return {end: feed, next: feed + 1}
}

/** Whether the line from `start` to `end` is `---` followed only by spaces and tabs. */
function isCloseLine(content: string, start: number, end: number): boolean {
  if (!content.startsWith('---', start)) return false
  for (let at = start + 3; at < end; at += 1) {
    const character = content.charAt(at)
    if (character !== ' ' && character !== '\t') return false
  }
  return true
}
