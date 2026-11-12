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
 * The content is cut at its line feeds once and each piece is visited once, so the running time is linear in the
 * length of the content, and the loop is bounded by the number of pieces.
 */
export function splitFrontmatterBlock(content: string): FrontmatterBlockSplit {
  const pieces = content.split('\n')
  const lastIndex = pieces.length - 1
  // `offset` is where the piece being read starts. `openingLength` is the length of the opening line with its line
  // feed, and `textEnd` is where the lines before the piece end, before their line ending.
  let offset = 0
  let openingLength = 0
  let textEnd = 0
  for (const [index, piece] of pieces.entries()) {
    // A piece that ends with a carriage return has a CRLF ending when a line feed followed it, that is, unless it is
    // the last piece.
    const line = index < lastIndex && piece.endsWith('\r') ? piece.slice(0, -1) : piece
    if (index === 0) {
      if (line !== '---') return {kind: 'none'}
      openingLength = piece.length + 1
      textEnd = openingLength
    } else if (isCloseLine(line)) {
      const lineEnd = offset + piece.length + 1
      return {
        kind: 'block',
        opening: content.slice(0, openingLength),
        text: content.slice(openingLength, textEnd),
        textEnding: content.slice(textEnd, offset),
        closing: content.slice(offset, lineEnd),
        body: content.slice(lineEnd),
      }
    } else {
      textEnd = offset + line.length
    }
    offset += piece.length + 1
  }
  return {kind: 'malformed'}
}

/** Whether `line` is `---` followed only by spaces and tabs. */
function isCloseLine(line: string): boolean {
  if (!line.startsWith('---')) return false
  for (let at = 3; at < line.length; at += 1) {
    const character = line.charAt(at)
    if (character !== ' ' && character !== '\t') return false
  }
  return true
}
