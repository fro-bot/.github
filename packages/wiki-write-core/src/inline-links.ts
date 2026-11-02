/**
 * The inline-link scanner behind `resolveMarkdownLinks`. It is an internal module: the package does not
 * export it, so the only way to reach it is through `markdown-links`.
 */

export interface InlineLink {
  /** Offset of the opening `[` in the line. */
  readonly index: number
  /** Length of the whole `[text](destination "title")` span. */
  readonly length: number
  /** The destination as written: `<angle>` with its brackets, or the bare run. */
  readonly target: string
}

/** The character codes the grammar tests for. */
const CLOSE_BRACKET = 0x5d
const OPEN_PAREN = 0x28
const CLOSE_PAREN = 0x29
const LESS_THAN = 0x3c
const GREATER_THAN = 0x3e
const DOUBLE_QUOTE = 0x22
const SINGLE_QUOTE = 0x27
const NEWLINE = 0x0a

/** The characters `\s` matches: ASCII spaces and controls, then the Unicode space separators. */
export function isWhitespaceCode(code: number): boolean {
  if (code <= 0x20) return code === 0x20 || (code >= 0x09 && code <= 0x0d)
  if (code < 0xa0) return false
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  )
}

/** For every offset `i` up to the line length plus one: the first offset at or after `i` whose character stops a run, or the line length. */
export function buildStopTable(line: string, stops: (code: number) => boolean): Int32Array {
  const table = new Int32Array(line.length + 2).fill(line.length)
  for (let index = line.length - 1; index >= 0; index -= 1) {
    table[index] = stops(line.charCodeAt(index)) ? index : (table[index + 1] ?? line.length)
  }
  return table
}

/**
 * Builds a function that finds the inline links of one line, `[text](destination "title")`, left to right.
 * `find(from)` returns the leftmost link that starts at or after `from`, or `undefined`.
 *
 * The grammar, over the characters of the line:
 * - `[`, a non-empty text with no `]` or newline, then `](`;
 * - optional whitespace, then the destination: `<` with a non-empty run of no `>` or newline and `>`, or else
 *   a non-empty run of no `)` or whitespace; the angle form is tried first and the bare run is the fallback
 *   when the angle form is not followed by a valid ending;
 * - an optional title, set off by whitespace, in double quotes, in single quotes or in parentheses, each with
 *   no newline inside and no closing delimiter before its end;
 * - optional whitespace, then `)`. A title that is present but does not lead to `)` is dropped, and the
 *   destination alone must then be followed by whitespace and `)`.
 *
 * Every run in the grammar ends at the first character that cannot continue it, so a run is read once from
 * a table of stop offsets built right to left, and every start offset is decided in constant time. The
 * tables are built on first use and only for a line that holds `](`.
 */
export function createInlineLinkFinder(line: string): (from: number) => InlineLink | undefined {
  if (!line.includes('](')) return () => undefined

  const tables = new Map<string, Int32Array>()
  const stopTable = (name: string, stops: (code: number) => boolean): Int32Array => {
    let table = tables.get(name)
    if (table === undefined) {
      table = buildStopTable(line, stops)
      tables.set(name, table)
    }
    return table
  }
  const stopAt = (name: string, from: number, stops: (code: number) => boolean): number =>
    stopTable(name, stops)[from] ?? line.length

  /** Offset of the `)` that ends a link whose destination ends at `destinationEnd`, plus one; -1 when there is none. */
  const endOfLink = (destinationEnd: number): number => {
    const afterSpace = stopAt('nonSpace', destinationEnd, code => !isWhitespaceCode(code))
    if (afterSpace > destinationEnd) {
      const opener = line.charCodeAt(afterSpace)
      const closer = opener === OPEN_PAREN ? CLOSE_PAREN : opener
      if (opener === DOUBLE_QUOTE || opener === SINGLE_QUOTE || opener === OPEN_PAREN) {
        const stop = stopAt(`title${closer}`, afterSpace + 1, code => code === closer || code === NEWLINE)
        if (line.charCodeAt(stop) === closer) {
          const closeAt = stopAt('nonSpace', stop + 1, code => !isWhitespaceCode(code))
          if (line.charCodeAt(closeAt) === CLOSE_PAREN) return closeAt + 1
        }
      }
    }
    return line.charCodeAt(afterSpace) === CLOSE_PAREN ? afterSpace + 1 : -1
  }

  const linkAt = (start: number): InlineLink | undefined => {
    const textEnd = stopAt('text', start + 1, code => code === CLOSE_BRACKET || code === NEWLINE)
    if (
      textEnd === start + 1 ||
      line.charCodeAt(textEnd) !== CLOSE_BRACKET ||
      line.charCodeAt(textEnd + 1) !== OPEN_PAREN
    ) {
      return undefined
    }

    const destinationStart = stopAt('nonSpace', textEnd + 2, code => !isWhitespaceCode(code))
    if (line.charCodeAt(destinationStart) === LESS_THAN) {
      const angleClose = stopAt('angle', destinationStart + 1, code => code === GREATER_THAN || code === NEWLINE)
      if (angleClose > destinationStart + 1 && line.charCodeAt(angleClose) === GREATER_THAN) {
        const end = endOfLink(angleClose + 1)
        if (end !== -1) {
          return {index: start, length: end - start, target: line.slice(destinationStart, angleClose + 1)}
        }
      }
    }

    const bareEnd = stopAt('bare', destinationStart, code => code === CLOSE_PAREN || isWhitespaceCode(code))
    if (bareEnd > destinationStart) {
      const end = endOfLink(bareEnd)
      if (end !== -1) {
        return {index: start, length: end - start, target: line.slice(destinationStart, bareEnd)}
      }
    }
    return undefined
  }

  return from => {
    for (let start = line.indexOf('[', from); start !== -1; start = line.indexOf('[', start + 1)) {
      const link = linkAt(start)
      if (link !== undefined) return link
    }
    return undefined
  }
}
