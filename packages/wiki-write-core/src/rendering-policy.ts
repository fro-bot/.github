export interface RenderingPolicyFinding {
  readonly kind: 'unsafe-html'
  readonly path: string
  readonly message: string
}

export interface RenderingPolicyValidationParams {
  readonly path: string
  readonly content: string
}

const UNSAFE_TAG_PATTERN =
  /<\/?\s*(?:script|iframe|object|embed|applet|base|form|input|button|textarea|select|option|meta|link|style|template|svg|math)\b[^>]*>/iu
const EVENT_HANDLER_PATTERN = /\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/iu
const UNSAFE_URI_PATTERN =
  /\s+(?:href|src|srcset|action|formaction|xlink:href|poster|background|cite)\s*=\s*(?:"\s*|')?(?:javascript|vbscript|data):/iu

/** Return save-side findings for HTML that the render policy will strip. */
export function validateRenderingPolicy(params: RenderingPolicyValidationParams): readonly RenderingPolicyFinding[] {
  const findings: RenderingPolicyFinding[] = []
  const renderableMarkdown = maskCodeContent(params.content)
  if (
    UNSAFE_TAG_PATTERN.test(renderableMarkdown) ||
    EVENT_HANDLER_PATTERN.test(renderableMarkdown) ||
    UNSAFE_URI_PATTERN.test(renderableMarkdown)
  ) {
    findings.push({
      kind: 'unsafe-html',
      path: params.path,
      message: 'Content contains HTML that is not permitted by the wiki rendering policy.',
    })
  }
  return findings
}

export function maskCodeContent(content: string): string {
  const lines = content.split('\n')
  let fence: {character: string; length: number} | undefined

  const masked = lines.map(line => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker !== undefined) {
      const character = marker[0] ?? ''
      if (fence === undefined) {
        fence = {character, length: marker.length}
      } else if (fence.character === character && marker.length >= fence.length) {
        fence = undefined
      }
      return line.replaceAll(/[^\n]/gu, ' ')
    }

    return fence === undefined ? line : line.replaceAll(/[^\n]/gu, ' ')
  })

  return masked.join('\n').replaceAll(/`[^`\n]*`/gu, value => value.replaceAll(/[^\n]/gu, ' '))
}

/**
 * Mask fenced/indented code and blockquotes so prose-only checks ignore quoted material.
 * Block structure is read from the original lines because inline-code masking can create
 * leading spaces. List tracking intentionally covers ordinary nested list content; a
 * blank line ends that bounded list context rather than attempting full CommonMark parsing.
 */
export function maskNonProseContent(content: string): string {
  const originalLines = content.split('\n')
  const maskedLines = maskCodeContent(content).split('\n')
  let inBlockquote = false
  let listIndent: number | undefined

  return originalLines
    .map((originalLine, index) => {
      const maskedLine = maskedLines[index] ?? originalLine
      const isBlank = originalLine.trim() === ''
      const isBlockquoteLine = /^ {0,3}>/u.test(originalLine)
      const isBlockStart = isMarkdownBlockStart(originalLine)

      if (isBlockquoteLine) inBlockquote = true
      else if (isBlank || (inBlockquote && isBlockStart)) inBlockquote = false

      if (isBlank) listIndent = undefined
      else if (!isBlockquoteLine && listIndent !== undefined && countIndent(originalLine) <= listIndent && isBlockStart)
        listIndent = undefined

      const listMarker = getListIndent(originalLine)
      const isListContinuation = listIndent !== undefined && countIndent(originalLine) > listIndent
      const isIndentedCode = /^(?: {4}|\t)/u.test(originalLine) && !isListContinuation
      if (listMarker !== undefined && !isBlockquoteLine) listIndent = listMarker

      if (isBlockquoteLine || inBlockquote || isIndentedCode) return originalLine.replaceAll(/[^\n]/gu, ' ')
      return maskedLine
    })
    .join('\n')
}

function isMarkdownBlockStart(line: string): boolean {
  const content = line.replace(/^ {0,3}/u, '')
  return (
    /^#{1,6}(?:\s|$)/u.test(content) ||
    getListIndent(line) !== undefined ||
    /^(?:`{3,}|~{3,})/u.test(content) ||
    /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(content)
  )
}

function getListIndent(line: string): number | undefined {
  const match = /^( *)(?:[-+*]|\d+[.)])(?:\s|$)/u.exec(line)
  return match?.[1]?.length
}

function countIndent(line: string): number {
  let indent = 0
  for (const character of line) {
    if (character === ' ') indent += 1
    else if (character === '\t') indent += 4
    else break
  }
  return indent
}
